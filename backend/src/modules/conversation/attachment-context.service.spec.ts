import { Test, TestingModule } from '@nestjs/testing';
import type { MessageAttachment } from 'shared';
import {
  AttachmentContextService,
  type UserContentPart,
} from './attachment-context.service';
import { StorageService } from '../upload/storage/storage.service';
import { DocumentParserService } from '../knowledge/document-parser.service';

/** UserContentPart 是可辨识联合，断言成 text part 后再取正文 */
function textOf(part: UserContentPart): string {
  if (part.type !== 'text') {
    throw new Error(`期望 text part，实际是 ${part.type}`);
  }
  return part.text;
}

/** 构造附件的便捷函数：只覆盖当前用例关心的字段 */
function attachment(over: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    type: 'image',
    key: 'ent1/user1/1700000000000_abcd_photo.png',
    url: 'https://example.com/signed/photo.png',
    name: 'photo.png',
    size: 1024,
    mimeType: 'image/png',
    ...over,
  };
}

describe('AttachmentContextService', () => {
  let service: AttachmentContextService;
  let storage: { get: jest.Mock };
  let documentParser: { parseDocument: jest.Mock };

  beforeEach(async () => {
    storage = { get: jest.fn() };
    documentParser = { parseDocument: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentContextService,
        { provide: StorageService, useValue: storage },
        { provide: DocumentParserService, useValue: documentParser },
      ],
    }).compile();

    // 附件处理失败会打 warn 日志，测试里不需要噪音
    module.useLogger(false);
    service = module.get(AttachmentContextService);
  });

  it('应该被正确实例化', () => {
    expect(service).toBeDefined();
  });

  describe('空输入', () => {
    it('空数组返回空上下文', async () => {
      const result = await service.build([], { includeImageBytes: true });
      expect(result).toEqual({ parts: [], summary: '' });
      expect(storage.get).not.toHaveBeenCalled();
    });

    it('undefined 也返回空上下文（防御调用方漏传）', async () => {
      const result = await service.build(
        undefined as unknown as MessageAttachment[],
        { includeImageBytes: true },
      );
      expect(result).toEqual({ parts: [], summary: '' });
    });
  });

  describe('图片附件', () => {
    it('当前轮：以字节形式作为 image part 注入', async () => {
      const bytes = Buffer.from('fake-png-bytes');
      storage.get.mockResolvedValue(bytes);

      const att = attachment({ name: '截图.png', mimeType: 'image/png' });
      const result = await service.build([att], { includeImageBytes: true });

      expect(storage.get).toHaveBeenCalledWith(att.key);
      expect(result.parts).toEqual([
        { type: 'image', image: bytes, mediaType: 'image/png' },
      ]);
      expect(result.summary).toBe('[图片：截图.png]');
    });

    it('mimeType 缺失时兜底为 image/png', async () => {
      storage.get.mockResolvedValue(Buffer.from('bytes'));

      const result = await service.build(
        [attachment({ mimeType: undefined })],
        { includeImageBytes: true },
      );

      expect(result.parts[0]).toMatchObject({ mediaType: 'image/png' });
    });

    it('历史轮：不读字节，只留文字标记（避免 token 膨胀）', async () => {
      const result = await service.build(
        [attachment({ name: '旧图.jpg' })],
        { includeImageBytes: false },
      );

      expect(storage.get).not.toHaveBeenCalled();
      expect(result.parts).toEqual([]);
      expect(result.summary).toBe('[历史图片：旧图.jpg]');
    });

    it('超过 8MB 的图片不提交给模型', async () => {
      const oversized = attachment({
        name: '大图.png',
        size: 9 * 1024 * 1024,
      });

      const result = await service.build([oversized], {
        includeImageBytes: true,
      });

      expect(storage.get).not.toHaveBeenCalled();
      expect(result.parts).toEqual([]);
      expect(result.summary).toBe('[图片 大图.png 过大（9.0 MB），未提交给模型]');
    });

    it('恰好 8MB 的图片仍然提交（边界值）', async () => {
      storage.get.mockResolvedValue(Buffer.from('bytes'));

      const result = await service.build(
        [attachment({ size: 8 * 1024 * 1024 })],
        { includeImageBytes: true },
      );

      expect(result.parts).toHaveLength(1);
      expect(result.parts[0].type).toBe('image');
    });
  });

  describe('文档附件', () => {
    it('纯文本类直接 UTF-8 解码，不落临时文件', async () => {
      storage.get.mockResolvedValue(Buffer.from('第一行\n第二行', 'utf-8'));

      const att = attachment({
        type: 'document',
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: 20,
      });
      const result = await service.build([att], { includeImageBytes: true });

      expect(documentParser.parseDocument).not.toHaveBeenCalled();
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]).toEqual({
        type: 'text',
        text: '\n\n<附件 name="notes.txt" type="document">\n第一行\n第二行\n</附件>',
      });
      expect(result.summary).toContain('已解析 7 字');
    });

    it('按扩展名识别文本类（mimeType 不可靠时）', async () => {
      storage.get.mockResolvedValue(Buffer.from('a,b,c', 'utf-8'));

      const result = await service.build(
        [
          attachment({
            type: 'document',
            name: 'data.csv',
            mimeType: 'application/octet-stream',
          }),
        ],
        { includeImageBytes: true },
      );

      expect(documentParser.parseDocument).not.toHaveBeenCalled();
      expect(textOf(result.parts[0])).toContain('a,b,c');
    });

    it('PDF 走临时文件 + DocumentParserService', async () => {
      storage.get.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
      documentParser.parseDocument.mockResolvedValue({
        text: '季度营收增长 12%',
        metadata: { pages: 3 },
      });

      const att = attachment({
        type: 'document',
        name: '季度报告.pdf',
        mimeType: 'application/pdf',
        size: 50_000,
      });
      const result = await service.build([att], { includeImageBytes: true });

      expect(documentParser.parseDocument).toHaveBeenCalledTimes(1);
      const [filePath, mime] = documentParser.parseDocument.mock.calls[0];
      expect(filePath).toContain('季度报告.pdf');
      expect(mime).toBe('application/pdf');

      expect(textOf(result.parts[0])).toBe(
        '\n\n<附件 name="季度报告.pdf" type="document">\n季度营收增长 12%\n</附件>',
      );
      expect(result.summary).toContain('[文档：季度报告.pdf（已解析 10 字）]');
    });

    it('解析器抛错时退化为占位文本，不中断对话', async () => {
      storage.get.mockResolvedValue(Buffer.from('corrupted'));
      documentParser.parseDocument.mockRejectedValue(
        new Error('Unsupported mime type: application/zip'),
      );

      const result = await service.build(
        [
          attachment({
            type: 'document',
            name: 'broken.docx',
            mimeType: 'application/zip',
            size: 8192,
          }),
        ],
        { includeImageBytes: true },
      );

      expect(result.parts).toEqual([
        {
          type: 'text',
          text: '\n\n[用户上传了文档「broken.docx」（8.0 KB），但正文无法解析]',
        },
      ]);
      expect(result.summary).toBe('[文档：broken.docx（解析失败）]');
    });

    it('解析出空正文时也走占位分支', async () => {
      storage.get.mockResolvedValue(Buffer.from('   '));
      documentParser.parseDocument.mockResolvedValue({ text: '   ' });

      const result = await service.build(
        [
          attachment({
            type: 'document',
            name: 'empty.pdf',
            mimeType: 'application/pdf',
            size: 512,
          }),
        ],
        { includeImageBytes: true },
      );

      expect(textOf(result.parts[0])).toContain('但正文无法解析');
      expect(result.summary).toContain('解析失败');
    });

    it('mimeType 缺失时以空串交给解析器（由其决定是否支持）', async () => {
      storage.get.mockResolvedValue(Buffer.from('binary'));
      documentParser.parseDocument.mockRejectedValue(
        new Error('Unsupported mime type: '),
      );

      const result = await service.build(
        [
          attachment({
            type: 'document',
            name: 'unknown.bin',
            mimeType: undefined,
            size: 100,
          }),
        ],
        { includeImageBytes: true },
      );

      expect(documentParser.parseDocument.mock.calls[0][1]).toBe('');
      expect(textOf(result.parts[0])).toContain('但正文无法解析');
    });

    it('解析结果缺少 text 字段时兜底为空串', async () => {
      storage.get.mockResolvedValue(Buffer.from('%PDF-1.4'));
      documentParser.parseDocument.mockResolvedValue({
        metadata: { pages: 1 },
      });

      const result = await service.build(
        [
          attachment({
            type: 'document',
            name: 'no-text.pdf',
            mimeType: 'application/pdf',
            size: 2048,
          }),
        ],
        { includeImageBytes: true },
      );

      expect(textOf(result.parts[0])).toContain('但正文无法解析');
      expect(result.summary).toContain('解析失败');
    });

    it('超长正文截断到 12000 字并加省略标记', async () => {
      const long = 'A'.repeat(15_000);
      storage.get.mockResolvedValue(Buffer.from(long, 'utf-8'));

      const result = await service.build(
        [
          attachment({
            type: 'document',
            name: 'long.md',
            mimeType: 'text/markdown',
            size: 15_000,
          }),
        ],
        { includeImageBytes: true },
      );

      const text = textOf(result.parts[0]);
      expect(text).toContain('A'.repeat(12_000));
      expect(text).not.toContain('A'.repeat(12_001));
      expect(text).toContain('…（正文过长，已截断）');
    });
  });

  describe('视频附件', () => {
    it('只注入文件名说明，不读字节', async () => {
      const result = await service.build(
        [
          attachment({
            type: 'video',
            name: 'demo.mp4',
            mimeType: 'video/mp4',
            size: 5 * 1024 * 1024,
          }),
        ],
        { includeImageBytes: true },
      );

      expect(storage.get).not.toHaveBeenCalled();
      expect(result.parts).toEqual([
        {
          type: 'text',
          text: '\n\n[用户上传了视频「demo.mp4」（5.0 MB），当前模型无法直接观看其内容]',
        },
      ]);
      expect(result.summary).toBe('[视频：demo.mp4]');
    });
  });

  describe('容错', () => {
    it('存储读取失败时降级为提示文本', async () => {
      storage.get.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await service.build(
        [attachment({ name: 'missing.png' })],
        { includeImageBytes: true },
      );

      expect(result.parts).toEqual([
        { type: 'text', text: '\n\n[附件「missing.png」读取失败]' },
      ]);
    });

    it('单个附件失败不影响同批其他附件', async () => {
      const goodBytes = Buffer.from('good-image');
      storage.get
        .mockResolvedValueOnce(goodBytes)
        .mockRejectedValueOnce(new Error('OSS timeout'));

      const result = await service.build(
        [
          attachment({ name: 'ok.png' }),
          attachment({ name: 'bad.jpg', key: 'k2', mimeType: 'image/jpeg' }),
        ],
        { includeImageBytes: true },
      );

      expect(result.parts).toHaveLength(2);
      expect(result.parts[0]).toEqual({
        type: 'image',
        image: goodBytes,
        mediaType: 'image/png',
      });
      expect(result.parts[1]).toEqual({
        type: 'text',
        text: '\n\n[附件「bad.jpg」读取失败]',
      });
    });
  });

  describe('混合批次', () => {
    it('图片 + 文档 + 视频按原顺序产出 parts', async () => {
      const imgBytes = Buffer.from('img');
      storage.get
        .mockResolvedValueOnce(imgBytes)
        .mockResolvedValueOnce(Buffer.from('报告正文', 'utf-8'));

      const result = await service.build(
        [
          attachment({ name: 'a.png' }),
          attachment({
            type: 'document',
            name: 'b.txt',
            mimeType: 'text/plain',
            key: 'k2',
          }),
          attachment({
            type: 'video',
            name: 'c.mp4',
            mimeType: 'video/mp4',
            key: 'k3',
            size: 2 * 1024 * 1024,
          }),
        ],
        { includeImageBytes: true },
      );

      expect(result.parts).toHaveLength(3);
      expect(result.parts[0].type).toBe('image');
      expect(textOf(result.parts[1])).toContain('<附件 name="b.txt"');
      expect(textOf(result.parts[2])).toContain('[用户上传了视频「c.mp4」');
      expect(result.summary).toBe(
        '[图片：a.png] [文档：b.txt（已解析 4 字）] [视频：c.mp4]',
      );
    });
  });

  describe('体积格式化', () => {
    it.each([
      [512, '512 B'],
      [2048, '2.0 KB'],
      [3 * 1024 * 1024, '3.0 MB'],
    ])('size=%i 渲染为 %s', async (size, expected) => {
      const result = await service.build(
        [attachment({ type: 'video', name: 'v.mp4', size })],
        { includeImageBytes: true },
      );
      expect(textOf(result.parts[0])).toContain(`（${expected}）`);
    });
  });
});
