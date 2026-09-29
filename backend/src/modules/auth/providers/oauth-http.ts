import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

export type OAuthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function getJson<T>(fetcher: OAuthFetch, url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  }
  if (!response.ok) throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  try {
    return (await response.json()) as T;
  } catch {
    throw new BadRequestException('第三方登录响应无效');
  }
}


export async function postJson<T>(fetcher: OAuthFetch, url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  }
  if (!response.ok) throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  try {
    return (await response.json()) as T;
  } catch {
    throw new BadRequestException('第三方登录响应无效');
  }
}

export async function getText(fetcher: OAuthFetch, url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: 'text/plain, application/json' } });
  } catch {
    throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  }
  if (!response.ok) throw new ServiceUnavailableException('第三方登录服务暂时不可用');
  return response.text();
}

export function requireProviderValue(value: string | undefined, message: string): string {
  if (!value) throw new ServiceUnavailableException(message);
  return value;
}
