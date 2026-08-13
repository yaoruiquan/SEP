import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { sanitizeFilename, validateUploadedFile } from './file-validator';
import { MAX_SIZE_BY_KIND } from './upload.constants';

/** 造一个带正确文件头的 buffer，尾部用 0 填到指定长度 */
function withMagic(bytes: number[], totalSize = bytes.length): Buffer {
  const buf = Buffer.alloc(Math.max(totalSize, bytes.length));
  Buffer.from(bytes).copy(buf, 0);
  return buf;
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_BYTES = [0xff, 0xd8, 0xff];
const PDF_BYTES = [0x25, 0x50, 0x44, 0x46];

function file(overrides: Partial<Parameters<typeof validateUploadedFile>[0]>) {
  const buffer = overrides.buffer ?? withMagic(PNG_BYTES, 1024);
  return {
    originalname: 'photo.png',
    buffer,
    size: overrides.size ?? buffer.length,
    ...overrides,
  };
}

describe('sanitizeFilename', () => {
  it('剥掉 POSIX 路径成分，只留文件名', () => {
    expect(sanitizeFilename('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFilename('/var/tmp/report.pdf')).toBe('report.pdf');
  });

  it('把反斜杠也当分隔符（Windows 客户端会上报完整路径）', () => {
    expect(sanitizeFilename('C:\\Users\\me\\Desktop\\图表.png')).toBe('图表.png');
  });

  it('保留中文与常规标点，替换其余字符', () => {
    expect(sanitizeFilename('季度报告 v2.pdf')).toBe('季度报告_v2.pdf');
    expect(sanitizeFilename('a;b&c|d.txt')).toBe('a_b_c_d.txt');
  });

  it('去掉控制字符', () => {
    expect(sanitizeFilename('bad\u0000name\u001f.txt')).toBe('badname.txt');
  });

  it('去掉开头的点，避免生成隐藏文件', () => {
    expect(sanitizeFilename('...hidden.txt')).toBe('hidden.txt');
  });

  it('主名被清洗成空时回退到 file（扩展名仍在）', () => {
    // '___' 全是非法字符 → 清洗后为空 → 回退 file
    expect(sanitizeFilename('___.txt')).toBe('file.txt');
    expect(sanitizeFilename('@@@.pdf')).toBe('file.pdf');
  });

  it('纯 dotfile 视为「无扩展名」，不伪造出扩展名', () => {
    // Node 的 extname('.png') === ''：`.png` 是隐藏文件名而非扩展名。
    // 这里不能凑成 'file.png'，否则等于替用户编造了一个类型。
    expect(sanitizeFilename('.png')).toBe('png');
  });

  it('截断超长文件名（扩展名保留）', () => {
    const long = `${'a'.repeat(200)}.png`;
    const result = sanitizeFilename(long);
    expect(result.endsWith('.png')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(84);
  });
});

describe('validateUploadedFile', () => {
  it('接受魔数正确的 PNG', () => {
    const result = validateUploadedFile(file({}));
    expect(result).toMatchObject({
      kind: 'image',
      ext: 'png',
      mime: 'image/png',
      safeName: 'photo.png',
    });
  });

  it('MIME 取白名单里的值，不信浏览器上报的', () => {
    const result = validateUploadedFile(
      file({ originalname: 'a.png', mimetype: 'application/x-evil' }),
    );
    expect(result.mime).toBe('image/png');
  });

  it('拒绝白名单外的扩展名', () => {
    expect(() =>
      validateUploadedFile(file({ originalname: 'run.exe' })),
    ).toThrow(BadRequestException);
  });

  it('拒绝没有扩展名的文件', () => {
    expect(() =>
      validateUploadedFile(file({ originalname: 'noext' })),
    ).toThrow(BadRequestException);
  });

  it('拒绝空文件', () => {
    expect(() =>
      validateUploadedFile(file({ buffer: Buffer.alloc(0), size: 0 })),
    ).toThrow(BadRequestException);
  });

  it('拒绝内容与扩展名不符的文件（改名绕过）', () => {
    // 真身是 PDF，却改名成 .png
    expect(() =>
      validateUploadedFile(
        file({ originalname: 'fake.png', buffer: withMagic(PDF_BYTES, 512) }),
      ),
    ).toThrow(BadRequestException);
  });

  it('拒绝文件头短于签名长度的文件', () => {
    expect(() =>
      validateUploadedFile(
        file({ originalname: 'tiny.png', buffer: Buffer.from([0x89, 0x50]) }),
      ),
    ).toThrow(BadRequestException);
  });

  it('超过所属类别的大小上限时抛 413', () => {
    expect(() =>
      validateUploadedFile(
        file({
          originalname: 'big.png',
          buffer: withMagic(PNG_BYTES, 64),
          size: MAX_SIZE_BY_KIND.image + 1,
        }),
      ),
    ).toThrow(PayloadTooLargeException);
  });

  it('大小上限按类别区分：图片超限的体积对视频是合法的', () => {
    const overImage = MAX_SIZE_BY_KIND.image + 1;
    expect(overImage).toBeLessThan(MAX_SIZE_BY_KIND.video);

    const mp4 = Buffer.alloc(64);
    Buffer.from([0x66, 0x74, 0x79, 0x70]).copy(mp4, 4);
    const result = validateUploadedFile({
      originalname: 'clip.mp4',
      buffer: mp4,
      size: overImage,
    });
    expect(result.kind).toBe('video');
  });

  it('纯文本类型跳过魔数校验（无稳定文件头）', () => {
    const result = validateUploadedFile({
      originalname: 'notes.md',
      buffer: Buffer.from('# 标题', 'utf8'),
      size: 8,
    });
    expect(result).toMatchObject({ kind: 'document', ext: 'md' });
  });

  it('校验发生在清洗之后：带路径的名字按 basename 判类型', () => {
    const result = validateUploadedFile(
      file({
        originalname: '../../secret/a.jpg',
        buffer: withMagic(JPEG_BYTES, 256),
      }),
    );
    expect(result.safeName).toBe('a.jpg');
    expect(result.kind).toBe('image');
  });

  it('webp 需要同时命中 RIFF 与 WEBP 两段签名', () => {
    const riffOnly = Buffer.alloc(64);
    Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(riffOnly, 0);
    expect(() =>
      validateUploadedFile(file({ originalname: 'x.webp', buffer: riffOnly })),
    ).toThrow(BadRequestException);

    const full = Buffer.alloc(64);
    Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(full, 0);
    Buffer.from([0x57, 0x45, 0x42, 0x50]).copy(full, 8);
    expect(
      validateUploadedFile(file({ originalname: 'x.webp', buffer: full })).kind,
    ).toBe('image');
  });
});
