import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * 对称加密工具（AES-256-GCM），用于加密存储 SystemSetting 中的敏感值（如上游 API Key）。
 *
 * 密钥派生：从 JWT_SECRET 经 SHA-256 派生 32 字节密钥，避免额外维护 ENCRYPTION_KEY。
 * 存储格式：`enc:v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>`
 *   - 带 `enc:v1:` 前缀，便于识别密文与历史明文，支持平滑迁移。
 */

const PREFIX = 'enc:v1:';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** 加密明文，返回带前缀的密文字符串。空值原样返回。 */
export function encryptSecret(plaintext: string, secret: string): string {
  if (!plaintext) return plaintext;
  const key = deriveKey(secret);
  const iv = randomBytes(12); // GCM 推荐 12 字节 IV
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** 解密密文。非本工具加密的值（无前缀）视为历史明文，原样返回。 */
export function decryptSecret(stored: string, secret: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':');
  const key = deriveKey(secret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** 是否为本工具加密的密文。 */
export function isEncrypted(value: string): boolean {
  return !!value && value.startsWith(PREFIX);
}

/** 脱敏显示：只保留末 4 位，其余用 • 代替。用于 API 回传，永不返回明文。 */
export function maskSecret(plaintext: string): string {
  if (!plaintext) return '';
  if (plaintext.length <= 4) return '••••';
  return '••••' + plaintext.slice(-4);
}
