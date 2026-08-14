import type { AttachmentKind } from './upload.constants';

/**
 * 上传成功后回传给前端、并原样存入 Message.attachments 的记录。
 *
 * `key` 与 `url` 都要存：url 有时效（签名会过期），key 是永久标识，
 * 历史消息重新打开时靠 key 重新签发链接。
 */
export interface UploadedAttachment {
  type: AttachmentKind;
  key: string;
  url: string;
  name: string;
  size: number;
  mimeType: string;
}
