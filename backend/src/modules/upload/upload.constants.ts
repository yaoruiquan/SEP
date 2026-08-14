/**
 * 附件上传的类型/大小白名单与魔数校验表。
 *
 * 前端也做一遍同样的校验（快速反馈），但后端这份才是权威 ——
 * 浏览器给的 MIME 可以随手伪造，所以除了扩展名/MIME，还要比对文件头魔数。
 */

export const ATTACHMENT_KINDS = ['image', 'document', 'video'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface AllowedFileType {
  /** 规范化的小写扩展名，不含点 */
  ext: string;
  /** 期望的 MIME（用于回传给前端，不作为唯一信任依据） */
  mime: string;
  kind: AttachmentKind;
  /** 文件头魔数候选；任一命中即通过。空数组表示该类型无稳定魔数（如纯文本） */
  magic: readonly MagicSignature[];
}

export interface MagicSignature {
  /** 从文件头第几个字节开始比对 */
  offset: number;
  /** 期望的字节序列 */
  bytes: readonly number[];
}

/** 各类别的大小上限（字节） */
export const MAX_SIZE_BY_KIND: Record<AttachmentKind, number> = {
  image: 10 * 1024 * 1024, // 10MB
  document: 20 * 1024 * 1024, // 20MB
  video: 100 * 1024 * 1024, // 100MB
};

/** 单次请求最多允许的文件数 */
export const MAX_FILES_PER_REQUEST = 5;

/** multer 的硬上限，取各类别里最大的那个 —— 细分限制在 service 里按 kind 再判一次 */
export const MULTER_MAX_FILE_SIZE = Math.max(...Object.values(MAX_SIZE_BY_KIND));

const JPEG: MagicSignature = { offset: 0, bytes: [0xff, 0xd8, 0xff] };
const PNG: MagicSignature = {
  offset: 0,
  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};
const GIF87: MagicSignature = {
  offset: 0,
  bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
};
const GIF89: MagicSignature = {
  offset: 0,
  bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
};
/** RIFF....WEBP —— 中间 4 字节是文件长度，跳过不比 */
const RIFF: MagicSignature = { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] };
const WEBP: MagicSignature = { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] };
const PDF: MagicSignature = { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] };
/** ZIP 头，docx/xlsx 等 OOXML 都是 zip 容器 */
const ZIP: MagicSignature = { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] };
/** 老式 OLE2 复合文档（.doc / .xls） */
const OLE2: MagicSignature = {
  offset: 0,
  bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
};
/** ISO BMFF：offset 4 处是 'ftyp'，mp4 / mov 共用 */
const FTYP: MagicSignature = { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] };

export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = [
  // ── 图片 ────────────────────────────────────────────────────────────────
  { ext: 'jpg', mime: 'image/jpeg', kind: 'image', magic: [JPEG] },
  { ext: 'jpeg', mime: 'image/jpeg', kind: 'image', magic: [JPEG] },
  { ext: 'png', mime: 'image/png', kind: 'image', magic: [PNG] },
  { ext: 'gif', mime: 'image/gif', kind: 'image', magic: [GIF87, GIF89] },
  { ext: 'webp', mime: 'image/webp', kind: 'image', magic: [RIFF, WEBP] },
  // ── 文档 ────────────────────────────────────────────────────────────────
  { ext: 'pdf', mime: 'application/pdf', kind: 'document', magic: [PDF] },
  { ext: 'doc', mime: 'application/msword', kind: 'document', magic: [OLE2] },
  {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
    magic: [ZIP],
  },
  { ext: 'txt', mime: 'text/plain', kind: 'document', magic: [] },
  { ext: 'md', mime: 'text/markdown', kind: 'document', magic: [] },
  { ext: 'csv', mime: 'text/csv', kind: 'document', magic: [] },
  // ── 视频 ────────────────────────────────────────────────────────────────
  { ext: 'mp4', mime: 'video/mp4', kind: 'video', magic: [FTYP] },
  { ext: 'mov', mime: 'video/quicktime', kind: 'video', magic: [FTYP] },
] as const;

export function findAllowedType(ext: string): AllowedFileType | undefined {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return ALLOWED_FILE_TYPES.find((t) => t.ext === normalized);
}

/** 人类可读的允许扩展名列表，用于报错文案 */
export const ALLOWED_EXT_LIST = ALLOWED_FILE_TYPES.map((t) => t.ext).join(', ');
