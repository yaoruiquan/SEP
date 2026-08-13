import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAttachmentUpload } from './use-attachment-upload';
import type { MessageAttachment } from '@/lib/types';

// 上传是唯一的外部副作用，mock 掉；其余（校验、类型判定）用真实实现，
// 这样 hook 与 lib/upload 的接线也一并被覆盖。
vi.mock('@/lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload')>();
  return { ...actual, uploadAttachment: vi.fn() };
});

import { uploadAttachment } from '@/lib/upload';

const mockUpload = vi.mocked(uploadAttachment);

function fakeFile(name: string, size = 1024): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function attachmentFor(name: string): MessageAttachment {
  return {
    type: 'image',
    key: `k-${name}`,
    url: `https://example.com/${name}`,
    name,
    size: 1024,
    mimeType: 'image/png',
  };
}

describe('useAttachmentUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom 不实现 createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('空列表、无错误、不在上传', () => {
      const { result } = renderHook(() => useAttachmentUpload());
      expect(result.current.items).toEqual([]);
      expect(result.current.ready).toEqual([]);
      expect(result.current.uploading).toBe(false);
      expect(result.current.limitError).toBeNull();
    });
  });

  describe('addFiles', () => {
    it('空数组是 no-op', () => {
      const { result } = renderHook(() => useAttachmentUpload());
      act(() => result.current.addFiles([]));
      expect(result.current.items).toEqual([]);
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('合法文件立即进入 uploading 并触发上传', async () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));

      // 选中即上传，不等发送
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]).toMatchObject({
        name: 'a.png',
        type: 'image',
        status: 'uploading',
      });
      expect(result.current.uploading).toBe(true);
      // 上传中不可发送
      expect(result.current.ready).toEqual([]);

      await waitFor(() => expect(result.current.items[0].status).toBe('done'));
      expect(result.current.uploading).toBe(false);
      expect(result.current.ready).toEqual([attachmentFor('a.png')]);
    });

    it('图片生成本地预览地址', () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));

      expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(result.current.items[0].previewUrl).toBe('blob:mock-url');
    });

    it('非图片不生成预览地址', () => {
      mockUpload.mockResolvedValue({
        ...attachmentFor('doc.pdf'),
        type: 'document',
      });
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('doc.pdf')]));

      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
      expect(result.current.items[0].previewUrl).toBeUndefined();
    });

    it('校验失败的文件直接标 error，不发起上传', () => {
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('virus.exe')]));

      expect(mockUpload).not.toHaveBeenCalled();
      expect(result.current.items[0]).toMatchObject({ status: 'error' });
      expect(result.current.items[0].error).toContain('不支持的文件类型');
      // 非法文件不该占预览地址
      expect(result.current.items[0].previewUrl).toBeUndefined();
      expect(result.current.uploading).toBe(false);
    });

    it('超大图片标 error 且不上传', () => {
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles([fakeFile('big.png', 11 * 1024 * 1024)]),
      );

      expect(mockUpload).not.toHaveBeenCalled();
      expect(result.current.items[0].error).toContain('超过 10.0 MB 上限');
    });

    it('上传失败时标 error 并保留后端错误文案', async () => {
      mockUpload.mockRejectedValue(new Error('magic number 校验失败'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));

      await waitFor(() => expect(result.current.items[0].status).toBe('error'));
      expect(result.current.items[0].error).toBe('magic number 校验失败');
      expect(result.current.ready).toEqual([]);
      expect(result.current.uploading).toBe(false);
    });

    it('上传抛非 Error 时给兜底文案', async () => {
      mockUpload.mockRejectedValue('boom');
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));

      await waitFor(() => expect(result.current.items[0].status).toBe('error'));
      expect(result.current.items[0].error).toBe('上传失败');
    });

    it('一个失败不影响同批其他文件', async () => {
      mockUpload
        .mockResolvedValueOnce(attachmentFor('ok.png'))
        .mockRejectedValueOnce(new Error('网络中断'));

      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles([fakeFile('ok.png'), fakeFile('bad.png')]),
      );

      await waitFor(() => expect(result.current.uploading).toBe(false));
      expect(result.current.items[0].status).toBe('done');
      expect(result.current.items[1].status).toBe('error');
      // 成功的那个仍可发送
      expect(result.current.ready).toHaveLength(1);
      expect(result.current.ready[0].name).toBe('ok.png');
    });

    it('每个 item 有唯一 id', () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles([
          fakeFile('a.png'),
          fakeFile('b.png'),
          fakeFile('c.png'),
        ]),
      );

      const ids = result.current.items.map((it) => it.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('数量上限', () => {
    it('单次超过 5 个时截断并提示忽略数', () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles(
          Array.from({ length: 7 }, (_, i) => fakeFile(`f${i}.png`)),
        ),
      );

      expect(result.current.items).toHaveLength(5);
      expect(result.current.limitError).toBe(
        '最多附加 5 个文件，已忽略 2 个',
      );
      expect(mockUpload).toHaveBeenCalledTimes(5);
    });

    it('已满时再加直接拒绝', () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles(
          Array.from({ length: 5 }, (_, i) => fakeFile(`f${i}.png`)),
        ),
      );
      mockUpload.mockClear();

      act(() => result.current.addFiles([fakeFile('extra.png')]));

      expect(result.current.items).toHaveLength(5);
      expect(result.current.limitError).toBe('最多附加 5 个文件');
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('连续两次选择正确累计（itemsRef 防竞态）', () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      // 关键用例：两次 addFiles 在同一个 act 里，React 还没重渲染，
      // 闭包里的 items 仍是 []。若只看 state 会误判还有 5 个位置。
      act(() => {
        result.current.addFiles([fakeFile('a.png'), fakeFile('b.png')]);
        result.current.addFiles([fakeFile('c.png'), fakeFile('d.png')]);
        result.current.addFiles([fakeFile('e.png'), fakeFile('f.png')]);
      });

      expect(result.current.items).toHaveLength(5);
      expect(result.current.limitError).toBe('最多附加 5 个文件，已忽略 1 个');
    });

    it('删掉一个后腾出位置', () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles(
          Array.from({ length: 5 }, (_, i) => fakeFile(`f${i}.png`)),
        ),
      );
      const firstId = result.current.items[0].id;

      act(() => result.current.remove(firstId));
      expect(result.current.items).toHaveLength(4);

      act(() => result.current.addFiles([fakeFile('new.png')]));
      expect(result.current.items).toHaveLength(5);
      expect(result.current.limitError).toBeNull();
    });

    it('新一轮 addFiles 清掉上次的上限提示', () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles(
          Array.from({ length: 6 }, (_, i) => fakeFile(`f${i}.png`)),
        ),
      );
      expect(result.current.limitError).not.toBeNull();

      act(() => result.current.remove(result.current.items[0].id));
      expect(result.current.limitError).toBeNull();
    });
  });

  describe('remove', () => {
    it('按 id 移除并回收预览地址', () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));
      const id = result.current.items[0].id;

      act(() => result.current.remove(id));

      expect(result.current.items).toEqual([]);
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('移除非图片不调用 revoke', () => {
      mockUpload.mockResolvedValue(attachmentFor('a.pdf'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.pdf')]));
      act(() => result.current.remove(result.current.items[0].id));

      expect(global.URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('移除不存在的 id 是安全的', () => {
      const { result } = renderHook(() => useAttachmentUpload());
      act(() => result.current.remove('nope'));
      expect(result.current.items).toEqual([]);
    });

    it('只移除目标，其余保留', () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles([
          fakeFile('a.png'),
          fakeFile('b.png'),
          fakeFile('c.png'),
        ]),
      );
      const midId = result.current.items[1].id;

      act(() => result.current.remove(midId));

      expect(result.current.items.map((it) => it.name)).toEqual([
        'a.png',
        'c.png',
      ]);
    });
  });

  describe('clear', () => {
    it('清空并回收所有预览地址', () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles([
          fakeFile('a.png'),
          fakeFile('b.png'),
          fakeFile('c.pdf'),
        ]),
      );

      act(() => result.current.clear());

      expect(result.current.items).toEqual([]);
      expect(result.current.ready).toEqual([]);
      expect(result.current.limitError).toBeNull();
      // 两张图片各一次，pdf 没有预览地址
      expect(global.URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    });

    it('清空后可以重新加满 5 个', () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles(
          Array.from({ length: 5 }, (_, i) => fakeFile(`f${i}.png`)),
        ),
      );
      act(() => result.current.clear());
      act(() =>
        result.current.addFiles(
          Array.from({ length: 5 }, (_, i) => fakeFile(`g${i}.png`)),
        ),
      );

      expect(result.current.items).toHaveLength(5);
      expect(result.current.limitError).toBeNull();
    });
  });

  describe('ready / uploading 派生状态', () => {
    it('只有 done 且带 attachment 的进 ready', async () => {
      mockUpload
        .mockResolvedValueOnce(attachmentFor('ok.png'))
        .mockRejectedValueOnce(new Error('失败'));

      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles([
          fakeFile('ok.png'),
          fakeFile('bad.png'),
          fakeFile('invalid.exe'),
        ]),
      );

      await waitFor(() => expect(result.current.uploading).toBe(false));

      expect(result.current.items).toHaveLength(3);
      expect(result.current.ready).toHaveLength(1);
      expect(result.current.ready[0].name).toBe('ok.png');
    });

    it('上传在 React 提交前就 resolve 也不丢状态', async () => {
      // 已经 resolve 的 promise：.then 会在 addFiles 返回后的微任务里立刻跑，
      // 早于 React 的渲染提交。若状态更新依赖已提交的 state，这里会丢 done。
      mockUpload.mockResolvedValue(attachmentFor('instant.png'));

      const { result } = renderHook(() => useAttachmentUpload());

      await act(async () => {
        result.current.addFiles([fakeFile('instant.png')]);
      });

      expect(result.current.items[0].status).toBe('done');
      expect(result.current.ready).toHaveLength(1);
      expect(result.current.uploading).toBe(false);
    });

    it('任一文件在传时 uploading 为 true', async () => {
      let resolveSecond: ((v: MessageAttachment) => void) | undefined;
      mockUpload
        .mockResolvedValueOnce(attachmentFor('fast.png'))
        .mockReturnValueOnce(
          new Promise<MessageAttachment>((res) => {
            resolveSecond = res;
          }),
        );

      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles([fakeFile('fast.png'), fakeFile('slow.png')]),
      );

      await waitFor(() => expect(result.current.items[0].status).toBe('done'));
      // 第二个还在传 —— 发送按钮此时必须禁用
      expect(result.current.uploading).toBe(true);

      await act(async () => {
        resolveSecond?.(attachmentFor('slow.png'));
      });

      expect(result.current.uploading).toBe(false);
      expect(result.current.ready).toHaveLength(2);
    });
  });

  /**
   * 发送失败时不能把用户上传好的文件丢掉 —— 几十兆重传一遍是真实的痛。
   * detach 摘走但不吊销预览地址，restore 原样放回，dispose 才真正释放。
   */
  describe('detach / restore / dispose（发送失败不丢附件）', () => {
    it('detach 返回快照并清空输入框，但不吊销 previewUrl', async () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));
      await waitFor(() => expect(result.current.ready).toHaveLength(1));

      let snapshot: ReturnType<typeof result.current.detach> = [];
      act(() => {
        snapshot = result.current.detach();
      });

      expect(result.current.items).toHaveLength(0);
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].attachment).toEqual(attachmentFor('a.png'));
      // 关键：还没 revoke，否则还原回去预览就是死链
      expect(global.URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('restore 把快照原样放回，ready 恢复可发送', async () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));
      await waitFor(() => expect(result.current.ready).toHaveLength(1));

      let snapshot: ReturnType<typeof result.current.detach> = [];
      act(() => {
        snapshot = result.current.detach();
      });
      act(() => result.current.restore(snapshot));

      expect(result.current.items).toHaveLength(1);
      expect(result.current.ready).toHaveLength(1);
      expect(result.current.ready[0]).toEqual(attachmentFor('a.png'));
    });

    it('restore 空快照是无操作', () => {
      const { result } = renderHook(() => useAttachmentUpload());
      act(() => result.current.restore([]));
      expect(result.current.items).toHaveLength(0);
    });

    it('还原后再次 detach 拿到的还是同一批', async () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));
      await waitFor(() => expect(result.current.ready).toHaveLength(1));

      let first: ReturnType<typeof result.current.detach> = [];
      act(() => {
        first = result.current.detach();
      });
      act(() => result.current.restore(first));

      let second: ReturnType<typeof result.current.detach> = [];
      act(() => {
        second = result.current.detach();
      });

      expect(second).toHaveLength(1);
      expect(second[0].id).toBe(first[0].id);
    });

    it('还原后 restore 的项排在新选文件之前（顺序不乱）', async () => {
      mockUpload.mockResolvedValue(attachmentFor('old.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('old.png')]));
      await waitFor(() => expect(result.current.ready).toHaveLength(1));

      let snapshot: ReturnType<typeof result.current.detach> = [];
      act(() => {
        snapshot = result.current.detach();
      });
      act(() => result.current.addFiles([fakeFile('new.png')]));
      act(() => result.current.restore(snapshot));

      expect(result.current.items.map((it) => it.name)).toEqual([
        'old.png',
        'new.png',
      ]);
    });

    it('dispose 吊销快照里的预览地址', async () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));
      await waitFor(() => expect(result.current.ready).toHaveLength(1));

      let snapshot: ReturnType<typeof result.current.detach> = [];
      act(() => {
        snapshot = result.current.detach();
      });
      act(() => result.current.dispose(snapshot));

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('clear 仍然等价于 detach + dispose（老行为不变）', async () => {
      mockUpload.mockResolvedValue(attachmentFor('a.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() => result.current.addFiles([fakeFile('a.png')]));
      await waitFor(() => expect(result.current.ready).toHaveLength(1));

      act(() => result.current.clear());

      expect(result.current.items).toHaveLength(0);
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('detach 会清掉数量上限提示', async () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles(
          Array.from({ length: 6 }, (_, i) => fakeFile(`f${i}.png`)),
        ),
      );
      expect(result.current.limitError).not.toBeNull();

      act(() => {
        result.current.detach();
      });
      expect(result.current.limitError).toBeNull();
    });

    it('detach 后重新选择文件，上限按空计算', async () => {
      mockUpload.mockResolvedValue(attachmentFor('x.png'));
      const { result } = renderHook(() => useAttachmentUpload());

      act(() =>
        result.current.addFiles(
          Array.from({ length: 5 }, (_, i) => fakeFile(`a${i}.png`)),
        ),
      );
      expect(result.current.items).toHaveLength(5);

      act(() => {
        result.current.detach();
      });
      act(() =>
        result.current.addFiles(
          Array.from({ length: 5 }, (_, i) => fakeFile(`b${i}.png`)),
        ),
      );

      expect(result.current.items).toHaveLength(5);
      expect(result.current.limitError).toBeNull();
    });
  });
});
