import {
  MessageAttachmentSchema,
  ATTACHMENT_TYPES,
  type MessageAttachment,
} from './index';

/**
 * 附件地址校验的回归测试。
 *
 * 背景：这个 schema 原来写的是 z.string().url()，但本地存储驱动返回的是
 * 根相对路径（/uploads/...），于是所有本地上传的附件在发消息时都被
 * "Validation failed" 拦掉，功能整条链路不通。之前的测试夹具全用绝对
 * URL，所以测试全绿而功能是坏的 —— 这里专门锁住相对路径必须放行。
 */
function valid(over: Partial<MessageAttachment> = {}): unknown {
  return {
    type: 'image',
    key: 'ent1/user1/1700000000000_abcd_photo.png',
    url: '/uploads/ent1/user1/1700000000000_abcd_photo.png',
    name: 'photo.png',
    size: 1024,
    mimeType: 'image/png',
    ...over,
  };
}

describe('MessageAttachmentSchema', () => {
  describe('url —— 本地驱动的根相对路径', () => {
    it('放行 /uploads/... 根相对路径（本地存储驱动的真实返回值）', () => {
      const result = MessageAttachmentSchema.safeParse(valid());
      expect(result.success).toBe(true);
    });

    it('放行带签名 query 的根相对路径', () => {
      const result = MessageAttachmentSchema.safeParse(
        valid({ url: '/uploads/a/b/c.png?exp=1700000000&sig=deadbeef' }),
      );
      expect(result.success).toBe(true);
    });

    it('放行任意根相对路径（不限定 /uploads 前缀）', () => {
      const result = MessageAttachmentSchema.safeParse(
        valid({ url: '/files/x.pdf' }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('url —— OSS 驱动的绝对地址', () => {
    it('放行 https 绝对地址', () => {
      const result = MessageAttachmentSchema.safeParse(
        valid({ url: 'https://oss.example.com/a/b.png?Signature=xxx' }),
      );
      expect(result.success).toBe(true);
    });

    it('放行 http 绝对地址', () => {
      const result = MessageAttachmentSchema.safeParse(
        valid({ url: 'http://oss.example.com/a/b.png' }),
      );
      expect(result.success).toBe(true);
    });

    it('协议大小写不敏感', () => {
      expect(
        MessageAttachmentSchema.safeParse(valid({ url: 'HTTPS://x.com/a.png' }))
          .success,
      ).toBe(true);
      expect(
        MessageAttachmentSchema.safeParse(valid({ url: 'HtTp://x.com/a.png' }))
          .success,
      ).toBe(true);
    });
  });

  describe('url —— 拒绝的形态', () => {
    it('拒绝空字符串', () => {
      expect(MessageAttachmentSchema.safeParse(valid({ url: '' })).success).toBe(
        false,
      );
    });

    it('拒绝不带前导斜杠的相对路径（相对当前页面，解析结果不可控）', () => {
      expect(
        MessageAttachmentSchema.safeParse(valid({ url: 'uploads/a.png' }))
          .success,
      ).toBe(false);
    });

    it('拒绝 javascript: 伪协议', () => {
      expect(
        MessageAttachmentSchema.safeParse(valid({ url: 'javascript:alert(1)' }))
          .success,
      ).toBe(false);
    });

    it('拒绝 data: URI', () => {
      expect(
        MessageAttachmentSchema.safeParse(
          valid({ url: 'data:image/png;base64,iVBORw0KGgo=' }),
        ).success,
      ).toBe(false);
    });

    it('拒绝 file: 协议', () => {
      expect(
        MessageAttachmentSchema.safeParse(valid({ url: 'file:///etc/passwd' }))
          .success,
      ).toBe(false);
    });

    it('拒绝非字符串', () => {
      expect(
        MessageAttachmentSchema.safeParse(valid({ url: 123 as never })).success,
      ).toBe(false);
    });
  });

  describe('其余字段', () => {
    it('接受所有合法的 type 枚举值', () => {
      for (const type of ATTACHMENT_TYPES) {
        expect(
          MessageAttachmentSchema.safeParse(valid({ type })).success,
        ).toBe(true);
      }
    });

    it('拒绝未知 type', () => {
      expect(
        MessageAttachmentSchema.safeParse(valid({ type: 'audio' as never }))
          .success,
      ).toBe(false);
    });

    it('key 不能为空', () => {
      expect(MessageAttachmentSchema.safeParse(valid({ key: '' })).success).toBe(
        false,
      );
    });

    it('name 不能为空且不超过 255 字符', () => {
      expect(
        MessageAttachmentSchema.safeParse(valid({ name: '' })).success,
      ).toBe(false);
      expect(
        MessageAttachmentSchema.safeParse(valid({ name: 'a'.repeat(255) }))
          .success,
      ).toBe(true);
      expect(
        MessageAttachmentSchema.safeParse(valid({ name: 'a'.repeat(256) }))
          .success,
      ).toBe(false);
    });

    it('size 必须是非负整数', () => {
      expect(
        MessageAttachmentSchema.safeParse(valid({ size: 0 })).success,
      ).toBe(true);
      expect(
        MessageAttachmentSchema.safeParse(valid({ size: -1 })).success,
      ).toBe(false);
      expect(
        MessageAttachmentSchema.safeParse(valid({ size: 1.5 })).success,
      ).toBe(false);
    });

    it('mimeType 可选', () => {
      const { mimeType, ...withoutMime } = valid() as Record<string, unknown>;
      void mimeType;
      expect(MessageAttachmentSchema.safeParse(withoutMime).success).toBe(true);
    });
  });
});
