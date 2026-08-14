import { API_BASE, uploadForm, api } from './api-client';
import type { AttachmentType, MessageAttachment } from './types';

/**
 * 附件上传的前端侧规则。
 *
 * 这份白名单是后端 `upload.constants.ts` 的镜像，目的只有一个：在用户选完
 * 文件的瞬间给出反馈，不用等一次往返。**它不是安全边界** —— 真正的校验
 * （魔数比对、大小、归属）都在后端，绕过这里最多只是拿到一个 400。
 */

export const ATTACHMENT_ACCEPT_BY_TYPE: Record<AttachmentType, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  document: ['pdf', 'doc', 'docx', 'txt', 'md', 'csv'],
  video: ['mp4', 'mov'],
};

export const MAX_SIZE_BY_TYPE: Record<AttachmentType, number> = {
  image: 10 * 1024 * 1024,
  document: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** `<input accept>` 用的扩展名串 */
export const FILE_ACCEPT_ATTR = Object.values(ATTACHMENT_ACCEPT_BY_TYPE)
  .flat()
  .map((ext) => `.${ext}`)
  .join(',');

const EXT_TO_TYPE: Record<string, AttachmentType> = Object.entries(
  ATTACHMENT_ACCEPT_BY_TYPE,
).reduce<Record<string, AttachmentType>>((acc, [type, exts]) => {
  for (const ext of exts) acc[ext] = type as AttachmentType;
  return acc;
}, {});

export const ALLOWED_EXT_LIST = Object.keys(EXT_TO_TYPE).join('、');

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function attachmentTypeOf(filename: string): AttachmentType | undefined {
  return EXT_TO_TYPE[extensionOf(filename)];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 校验单个文件；通过返回 null，否则返回中文错误文案。 */
export function validateFile(file: File): string | null {
  const type = attachmentTypeOf(file.name);
  if (!type) {
    return `不支持的文件类型，仅支持：${ALLOWED_EXT_LIST}`;
  }
  if (file.size === 0) {
    return '文件内容为空';
  }
  const limit = MAX_SIZE_BY_TYPE[type];
  if (file.size > limit) {
    return `文件超过 ${formatBytes(limit)} 上限（当前 ${formatBytes(file.size)}）`;
  }
  return null;
}

/**
 * 把附件的签名地址补成浏览器可请求的形式。
 *
 * 本地驱动返回相对路径（`/uploads/...`），要加 `/api` 前缀才能命中 Next 的
 * 同源代理；配了 OSS 后返回的是完整 https 地址，此时原样返回。
 */
export function resolveAttachmentUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** 批量上传，返回可直接放进消息 attachments 的记录。 */
export async function uploadAttachments(
  files: File[],
): Promise<MessageAttachment[]> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  return uploadForm<MessageAttachment[]>('/upload/files', form);
}

/** 单文件上传 —— 逐个上传时用它，能把失败精确定位到某个文件。 */
export async function uploadAttachment(file: File): Promise<MessageAttachment> {
  const form = new FormData();
  form.append('file', file);
  return uploadForm<MessageAttachment>('/upload/file', form);
}

/** 链接过期后按 key 重新签发。 */
export async function refreshAttachmentUrl(key: string): Promise<string> {
  const res = await api.post<{ url: string }>(
    `/upload/refresh-url?key=${encodeURIComponent(key)}`,
  );
  return res.url;
}
