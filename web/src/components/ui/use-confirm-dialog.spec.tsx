import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useConfirmDialog, type ConfirmOptions } from './use-confirm-dialog';

// jsdom 没有 matchMedia，DialogContent 走 usePrefersReducedMotion。
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

/**
 * 测试宿主：暴露 confirm() 并把弹窗结果写进 DOM，
 * 这样断言可以观察 promise 的 settle 值。
 */
function Harness({ options }: { options: ConfirmOptions }) {
  const { confirm, dialog } = useConfirmDialog();
  return (
    <div>
      <button
        onClick={async () => {
          const ok = await confirm(options);
          const out = document.createElement('span');
          out.textContent = `resolved:${ok}`;
          document.body.appendChild(out);
        }}
      >
        trigger
      </button>
      {dialog}
    </div>
  );
}

async function readResolution(): Promise<string> {
  await vi.waitFor(() => {
    const nodes = screen.getAllByText(/^resolved:/);
    expect(nodes.length).toBeGreaterThan(0);
  });
  const nodes = screen.getAllByText(/^resolved:/);
  return nodes[nodes.length - 1].textContent ?? '';
}

describe('useConfirmDialog', () => {
  it('resolves true when the user confirms', async () => {
    render(<Harness options={{ title: '删除公告', description: '确定要删除吗？' }} />);

    fireEvent.click(screen.getByText('trigger'));
    fireEvent.click(await screen.findByText('确定要删除吗？')); // dialog rendered
    fireEvent.click(screen.getByText('确认'));

    expect(await readResolution()).toBe('resolved:true');
  });

  it('resolves false when the user cancels', async () => {
    render(<Harness options={{ title: '删除角色', description: '确定要删除角色吗？' }} />);

    fireEvent.click(screen.getByText('trigger'));
    fireEvent.click(await screen.findByText('确定要删除角色吗？'));
    fireEvent.click(screen.getByText('取消'));

    expect(await readResolution()).toBe('resolved:false');
  });

  it('returns focus to the trigger after the dialog closes', async () => {
    render(<Harness options={{ title: '删除公告', description: '确定要删除吗？' }} />);

    const trigger = screen.getByRole('button', { name: 'trigger' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText('确定要删除吗？'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it('renders the custom confirm text and title', async () => {
    render(
      <Harness
        options={{ title: '吊销密钥', description: '此操作不可撤销', confirmText: '吊销', variant: 'danger' }}
      />,
    );

    fireEvent.click(screen.getByText('trigger'));
    expect(await screen.findByText('吊销密钥')).toBeTruthy();
    expect(screen.getByText('吊销')).toBeTruthy();
  });
});
