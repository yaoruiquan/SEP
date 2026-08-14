import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ALLOWED_EXT_LIST,
  ATTACHMENT_ACCEPT_BY_TYPE,
  FILE_ACCEPT_ATTR,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_SIZE_BY_TYPE,
  attachmentTypeOf,
  extensionOf,
  formatBytes,
  resolveAttachmentUrl,
  validateFile,
} from './upload';

/** 构造一个指定大小的 File，不真的分配内存 */
function fakeFile(name: string, size: number): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('extensionOf', () => {
  it.each([
    ['photo.png', 'png'],
    ['report.PDF', 'pdf'],
    ['archive.tar.gz', 'gz'],
    ['数据.csv', 'csv'],
  ])('%s → %s', (name, expected) => {
    expect(extensionOf(name)).toBe(expected);
  });

  it('无扩展名返回空串', () => {
    expect(extensionOf('README')).toBe('');
  });

  it('以点结尾返回空串', () => {
    expect(extensionOf('weird.')).toBe('');
  });

  it('隐藏文件（.env）把名字当扩展名 —— 后续会被白名单挡掉', () => {
    expect(extensionOf('.env')).toBe('env');
  });
});

describe('attachmentTypeOf', () => {
  it.each([
    ['a.jpg', 'image'],
    ['a.jpeg', 'image'],
    ['a.png', 'image'],
    ['a.gif', 'image'],
    ['a.webp', 'image'],
  ])('%s 归类为 image', (name, expected) => {
    expect(attachmentTypeOf(name)).toBe(expected);
  });

  it.each([['a.pdf'], ['a.doc'], ['a.docx'], ['a.txt'], ['a.md'], ['a.csv']])(
    '%s 归类为 document',
    (name) => {
      expect(attachmentTypeOf(name)).toBe('document');
    },
  );

  it.each([['a.mp4'], ['a.mov']])('%s 归类为 video', (name) => {
    expect(attachmentTypeOf(name)).toBe('video');
  });

  it('白名单外返回 undefined', () => {
    expect(attachmentTypeOf('malware.exe')).toBeUndefined();
    expect(attachmentTypeOf('script.sh')).toBeUndefined();
    expect(attachmentTypeOf('noext')).toBeUndefined();
  });

  it('大小写不敏感', () => {
    expect(attachmentTypeOf('IMG.PNG')).toBe('image');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [2048, '2 KB'],
    [1024 * 1024, '1.0 MB'],
    [10 * 1024 * 1024, '10.0 MB'],
  ])('%i → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('validateFile', () => {
  it('合法图片通过', () => {
    expect(validateFile(fakeFile('photo.png', 1024))).toBeNull();
  });

  it('不支持的类型给出白名单提示', () => {
    const err = validateFile(fakeFile('virus.exe', 1024));
    expect(err).toContain('不支持的文件类型');
    expect(err).toContain(ALLOWED_EXT_LIST);
  });

  it('空文件被拒', () => {
    expect(validateFile(fakeFile('empty.png', 0))).toBe('文件内容为空');
  });

  it('图片超过 10MB 被拒', () => {
    const err = validateFile(fakeFile('big.png', 11 * 1024 * 1024));
    expect(err).toContain('超过 10.0 MB 上限');
    expect(err).toContain('当前 11.0 MB');
  });

  it('文档超过 20MB 被拒', () => {
    const err = validateFile(fakeFile('big.pdf', 21 * 1024 * 1024));
    expect(err).toContain('超过 20.0 MB 上限');
  });

  it('视频超过 100MB 被拒', () => {
    const err = validateFile(fakeFile('big.mp4', 101 * 1024 * 1024));
    expect(err).toContain('超过 100.0 MB 上限');
  });

  it('恰好等于上限时通过（边界值）', () => {
    expect(validateFile(fakeFile('exact.png', MAX_SIZE_BY_TYPE.image))).toBeNull();
    expect(
      validateFile(fakeFile('exact.pdf', MAX_SIZE_BY_TYPE.document)),
    ).toBeNull();
    expect(validateFile(fakeFile('exact.mp4', MAX_SIZE_BY_TYPE.video))).toBeNull();
  });

  it('类型判定先于大小判定 —— 超大的非法类型报类型错误', () => {
    const err = validateFile(fakeFile('huge.exe', 999 * 1024 * 1024));
    expect(err).toContain('不支持的文件类型');
  });
});

describe('resolveAttachmentUrl', () => {
  it('相对路径加上 API_BASE 前缀（走 Next 同源代理）', () => {
    expect(resolveAttachmentUrl('/uploads/a/b.png')).toBe(
      '/api/uploads/a/b.png',
    );
  });

  it('不以斜杠开头时补斜杠', () => {
    expect(resolveAttachmentUrl('uploads/a/b.png')).toBe(
      '/api/uploads/a/b.png',
    );
  });

  it('完整 https 地址原样返回（OSS 场景）', () => {
    const oss = 'https://bucket.oss-cn-hangzhou.aliyuncs.com/x.png?sig=abc';
    expect(resolveAttachmentUrl(oss)).toBe(oss);
  });

  it('http 也原样返回', () => {
    expect(resolveAttachmentUrl('http://cdn.example.com/x.png')).toBe(
      'http://cdn.example.com/x.png',
    );
  });

  it('协议判断大小写不敏感', () => {
    expect(resolveAttachmentUrl('HTTPS://cdn.example.com/x.png')).toBe(
      'HTTPS://cdn.example.com/x.png',
    );
  });
});

describe('常量一致性', () => {
  it('FILE_ACCEPT_ATTR 覆盖全部白名单扩展名', () => {
    const all = Object.values(ATTACHMENT_ACCEPT_BY_TYPE).flat();
    for (const ext of all) {
      expect(FILE_ACCEPT_ATTR).toContain(`.${ext}`);
    }
  });

  it('单条消息附件上限与后端对齐（5）', () => {
    // 后端 shared/index.ts 的 MAX_ATTACHMENTS_PER_MESSAGE 也是 5，
    // 这里写死是为了改动其中一侧时测试立刻报警。
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(5);
  });

  it('三类都有大小上限且递增', () => {
    expect(MAX_SIZE_BY_TYPE.image).toBeLessThan(MAX_SIZE_BY_TYPE.document);
    expect(MAX_SIZE_BY_TYPE.document).toBeLessThan(MAX_SIZE_BY_TYPE.video);
  });
});
