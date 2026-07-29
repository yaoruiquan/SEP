import { authAccessor, type AuthPayload } from './auth-store';

/**
 * All requests go through the Next.js rewrite proxy at /api/* → backend.
 * This keeps the browser same-origin so the refresh_token httpOnly cookie
 * is sent automatically (credentials: 'include').
 */
export const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** skip the automatic 401→refresh→retry (used by the refresh call itself) */
  skipAuthRetry?: boolean;
}

async function rawRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, skipAuthRetry, headers, ...rest } = opts;
  const token = authAccessor.getToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !skipAuthRetry) {
    // try to silently refresh the access token once, then retry
    const refreshed = await tryRefresh();
    if (refreshed) {
      return rawRequest<T>(path, { ...opts, skipAuthRetry: true });
    }
    authAccessor.clear();
    throw new ApiError(401, 'Unauthorized');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data
        ? Array.isArray((data as any).message)
          ? (data as any).message.join('; ')
          : String((data as any).message)
        : res.statusText) || '请求失败';
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/** Calls GET /auth/refresh; on success updates the store. Deduped. */
export async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as AuthPayload;
      authAccessor.setAuth(data);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    rawRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    rawRequest<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    rawRequest<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    rawRequest<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    rawRequest<T>(path, { ...opts, method: 'DELETE' }),
};

/**
 * 下载二进制文件（员工包 ZIP）。
 *
 * 不能用 <a href> 直接下载 —— 下载接口要 Authorization 头，
 * 而 access token 只存在内存里，浏览器的原生导航带不上它。
 * 故用 fetch 拿 blob 再触发一次本地下载。
 *
 * 返回服务端给的 X-SHA256，调用方可展示给用户核对完整性。
 */
export async function downloadFile(
  path: string,
): Promise<{ filename: string; sha256: string | null }> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const data = text ? safeJson(text) : undefined;
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : '下载失败';
    throw new ApiError(res.status, message, data);
  }

  // 文件名优先取服务端的 Content-Disposition，回退到 URL 末段
  const disp = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disp);
  const plain = /filename="([^"]+)"/i.exec(disp);
  const raw = star?.[1] ?? plain?.[1] ?? 'package.zip';
  let filename = 'package.zip';
  try {
    filename = decodeURIComponent(raw);
  } catch {
    filename = raw;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 不 revoke 的话 blob 会一直占着内存，直到页面卸载
  URL.revokeObjectURL(url);

  return { filename, sha256: res.headers.get('x-sha256') };
}

/** 上传 multipart 表单（员工包发布）。不设 Content-Type，让浏览器带 boundary。 */
export async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? Array.isArray((data as { message: unknown }).message)
          ? (data as { message: string[] }).message.join('; ')
          : String((data as { message: unknown }).message)
        : '上传失败';
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}
