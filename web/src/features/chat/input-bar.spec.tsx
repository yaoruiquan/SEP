import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InputBar } from './input-bar';
import type { MessageAttachment } from '@/lib/types';

// 上传是唯一的外部副作用；其余（附件 hook、校验）走真实实现，
// 这样"发送失败还原附件"这条链路是真的被覆盖，不是被 mock 掉的。
vi.mock('@/lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload')>();
  return { ...actual, uploadAttachment: vi.fn() };
});

import { uploadAttachment } from '@/lib/upload';

const mockUpload = vi.mocked(uploadAttachment);

function attachmentFor(name: string): MessageAttachment {
  return {
    type: 'image',
    key: `k-${name}`,
    // 本地存储驱动返回的就是这种根相对路径
    url: `/uploads/ent1/user1/${name}`,
    name,
    size: 1024,
    mimeType: 'image/png',
  };
}

function fakeFile(name: string, size = 1024): File {
  const file = new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function textarea() {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

function sendButton() {
  return screen.getByTitle('发送');
}

async function attachOneFile(name = 'photo.png') {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [fakeFile(name)] } });
  });
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
}

describe('InputBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  describe('发送成功', () => {
    it('清空输入框', async () => {
      const onSend = vi.fn().mockResolvedValue('ok');
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      fireEvent.change(textarea(), { target: { value: '你好' } });
      await act(async () => {
        fireEvent.click(sendButton());
      });

      expect(onSend).toHaveBeenCalledWith('你好', 'emp-1', undefined);
      expect(textarea().value).toBe('');
    });

    it('带附件发送后附件列表清空，预览地址被吊销', async () => {
      mockUpload.mockResolvedValue(attachmentFor('photo.png'));
      const onSend = vi.fn().mockResolvedValue('ok');
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      await attachOneFile();
      fireEvent.change(textarea(), { target: { value: '看图' } });

      await act(async () => {
        fireEvent.click(sendButton());
      });

      expect(onSend).toHaveBeenCalledWith('看图', 'emp-1', [
        attachmentFor('photo.png'),
      ]);
      expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('onSend 返回 void（老调用方）也视作成功', async () => {
      const onSend = vi.fn();
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      fireEvent.change(textarea(), { target: { value: '你好' } });
      await act(async () => {
        fireEvent.click(sendButton());
      });

      expect(textarea().value).toBe('');
    });
  });

  /**
   * 回归：附件 schema 把本地相对路径拦成 400 时，用户的文字和刚上传的
   * 文件被静默丢弃，得重新打字重新传 —— 观感就是"消息发不出去还没了"。
   */
  describe('发送失败（failed）要还原', () => {
    it('把文字还回输入框', async () => {
      const onSend = vi.fn().mockResolvedValue('failed');
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      fireEvent.change(textarea(), { target: { value: '重要的长文本' } });
      await act(async () => {
        fireEvent.click(sendButton());
      });

      await waitFor(() => expect(textarea().value).toBe('重要的长文本'));
    });

    it('把已上传的附件还回去，且不吊销预览地址', async () => {
      mockUpload.mockResolvedValue(attachmentFor('photo.png'));
      const onSend = vi.fn().mockResolvedValue('failed');
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      await attachOneFile();
      fireEvent.change(textarea(), { target: { value: '看图' } });

      await act(async () => {
        fireEvent.click(sendButton());
      });

      await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());
      expect(textarea().value).toBe('看图');
      // 还原后预览还得能显示，所以不能 revoke
      expect(global.URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('还原后可以直接重发，附件不用重新上传', async () => {
      mockUpload.mockResolvedValue(attachmentFor('photo.png'));
      const onSend = vi
        .fn()
        .mockResolvedValueOnce('failed')
        .mockResolvedValueOnce('ok');
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      await attachOneFile();
      fireEvent.change(textarea(), { target: { value: '看图' } });

      await act(async () => {
        fireEvent.click(sendButton());
      });
      await waitFor(() => expect(textarea().value).toBe('看图'));

      // 第二次点发送 —— 上传只应该发生过一次
      await act(async () => {
        fireEvent.click(sendButton());
      });

      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledTimes(2);
      expect(onSend).toHaveBeenLastCalledWith('看图', 'emp-1', [
        attachmentFor('photo.png'),
      ]);
      expect(textarea().value).toBe('');
    });
  });

  describe('用户主动停止（aborted）不还原', () => {
    it('消息已发出并落库，还原会导致重复发送', async () => {
      const onSend = vi.fn().mockResolvedValue('aborted');
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      fireEvent.change(textarea(), { target: { value: '停一下' } });
      await act(async () => {
        fireEvent.click(sendButton());
      });

      expect(textarea().value).toBe('');
    });
  });

  describe('canSend 门禁', () => {
    it('空输入且无附件时不发送', async () => {
      const onSend = vi.fn();
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      await act(async () => {
        fireEvent.click(sendButton());
      });
      expect(onSend).not.toHaveBeenCalled();
    });

    it('纯空白字符不发送', async () => {
      const onSend = vi.fn();
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      fireEvent.change(textarea(), { target: { value: '   \n  ' } });
      await act(async () => {
        fireEvent.click(sendButton());
      });
      expect(onSend).not.toHaveBeenCalled();
    });

    it('纯附件（无文字）可以发送', async () => {
      mockUpload.mockResolvedValue(attachmentFor('photo.png'));
      const onSend = vi.fn().mockResolvedValue('ok');
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      await attachOneFile();
      await act(async () => {
        fireEvent.click(sendButton());
      });

      expect(onSend).toHaveBeenCalledWith('', 'emp-1', [
        attachmentFor('photo.png'),
      ]);
    });

    it('附件还在上传时禁止发送（否则会漏附件）', async () => {
      mockUpload.mockReturnValue(new Promise(() => {}));
      const onSend = vi.fn();
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { files: [fakeFile('slow.png')] } });
      });

      fireEvent.change(textarea(), { target: { value: '等一下' } });
      await act(async () => {
        fireEvent.click(screen.getByTitle('附件上传中…'));
      });

      expect(onSend).not.toHaveBeenCalled();
      expect(textarea().value).toBe('等一下');
    });

    it('disabled 时不发送', async () => {
      const onSend = vi.fn();
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" disabled />);

      fireEvent.change(textarea(), { target: { value: '你好' } });
      await act(async () => {
        fireEvent.click(sendButton());
      });
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe('键盘与粘贴', () => {
    it('Enter 发送', async () => {
      const onSend = vi.fn().mockResolvedValue('ok');
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      fireEvent.change(textarea(), { target: { value: '你好' } });
      await act(async () => {
        fireEvent.keyDown(textarea(), { key: 'Enter' });
      });

      expect(onSend).toHaveBeenCalled();
    });

    it('Shift+Enter 换行不发送', async () => {
      const onSend = vi.fn();
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      fireEvent.change(textarea(), { target: { value: '第一行' } });
      await act(async () => {
        fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true });
      });

      expect(onSend).not.toHaveBeenCalled();
    });

    it('输入法组合中的 Enter 不发送', async () => {
      const onSend = vi.fn();
      render(<InputBar onSend={onSend} defaultEmployeeId="emp-1" />);

      fireEvent.change(textarea(), { target: { value: 'nihao' } });
      await act(async () => {
        fireEvent.keyDown(textarea(), { key: 'Enter', isComposing: true });
      });

      expect(onSend).not.toHaveBeenCalled();
    });
  });
});
