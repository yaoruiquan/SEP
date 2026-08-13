import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { basename, extname } from 'path';
import {
  ALLOWED_EXT_LIST,
  AttachmentKind,
  MAX_SIZE_BY_KIND,
  MagicSignature,
  findAllowedType,
} from './upload.constants';

export interface ValidatedFile {
  kind: AttachmentKind;
  /** 规范化扩展名，不含点 */
  ext: string;
  /** 以白名单为准的 MIME，而非浏览器上报的那个 */
  mime: string;
  /** 去掉路径成分、截断长度后的安全文件名 */
  safeName: string;
  size: number;
}

/** 文件名最大保留长度（不含扩展名），防止超长名字撑爆存储键 */
const MAX_BASENAME_LENGTH = 80;

/**
 * 清洗用户提供的文件名。
 *
 * 攻击面有两块：路径穿越（`../../etc/passwd`）和控制字符。
 * 这里只保留 basename，再把非常规字符替换成下划线 —— 存储键最终还会
 * 拼上时间戳与随机数，所以不要求清洗后仍然唯一。
 */
export function sanitizeFilename(raw: string): string {
  // 反斜杠也要当分隔符处理：Windows 客户端会上报 `C:\path\file.png`
  const withoutPath = basename(raw.replace(/\\/g, '/')).trim();
  const ext = extname(withoutPath).toLowerCase();
  const stem = withoutPath.slice(0, withoutPath.length - ext.length);

  const cleanedStem = stem
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^[._-]+/, '')
    .slice(0, MAX_BASENAME_LENGTH);

  const cleanedExt = ext.replace(/[^a-z0-9.]/g, '');
  const name = `${cleanedStem || 'file'}${cleanedExt}`;
  return name;
}

function matchesMagic(buffer: Buffer, sig: MagicSignature): boolean {
  if (buffer.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buffer[sig.offset + i] !== sig.bytes[i]) return false;
  }
  return true;
}

/**
 * 校验单个上传文件：扩展名白名单 → 魔数 → 大小上限。
 *
 * 抛 HTTP 异常而非返回错误码，让 Nest 直接把状态码带给前端。
 */
export function validateUploadedFile(file: {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype?: string;
}): ValidatedFile {
  const safeName = sanitizeFilename(file.originalname || 'file');
  const ext = extname(safeName).replace(/^\./, '').toLowerCase();

  if (!ext) {
    throw new BadRequestException(
      `文件 "${safeName}" 缺少扩展名，仅支持：${ALLOWED_EXT_LIST}`,
    );
  }

  const allowed = findAllowedType(ext);
  if (!allowed) {
    throw new BadRequestException(
      `不支持的文件类型 ".${ext}"，仅支持：${ALLOWED_EXT_LIST}`,
    );
  }

  const size = file.size ?? file.buffer?.length ?? 0;
  if (size <= 0) {
    throw new BadRequestException(`文件 "${safeName}" 为空`);
  }

  const limit = MAX_SIZE_BY_KIND[allowed.kind];
  if (size > limit) {
    throw new PayloadTooLargeException(
      `文件 "${safeName}" 超过 ${Math.round(limit / 1024 / 1024)}MB 上限`,
    );
  }

  // 魔数为空的类型（txt/md/csv）无稳定文件头，跳过这步；
  // 其余类型必须命中其中一个签名，否则视为扩展名伪造。
  if (allowed.magic.length > 0) {
    const ok = allowed.magic.every((sig) => matchesMagic(file.buffer, sig));
    if (!ok) {
      throw new BadRequestException(
        `文件 "${safeName}" 内容与扩展名 ".${ext}" 不符`,
      );
    }
  }

  return {
    kind: allowed.kind,
    ext,
    mime: allowed.mime,
    safeName,
    size,
  };
}
