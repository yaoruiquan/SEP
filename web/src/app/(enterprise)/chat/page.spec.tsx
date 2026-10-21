import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import ChatPage from './page';

const mocks = vi.hoisted(() => ({
  sessions: [] as Array<any>,
  createMutate: vi.fn(),
  renameMutate: vi.fn(),
  deleteMutate: vi.fn(),
  search: '',
  replace: vi.fn(),
  creating: false,
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  usePathname: () => '/chat',
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/components/ui/toast', () => ({ toast: { error: mocks.toastError } }));

vi.mock('@/features/chat/use-conversations', () => ({
  useConversations: () => ({ data: mocks.sessions, isLoading: false }),
  useCreateConversation: () => ({ mutate: mocks.createMutate, isPending: mocks.creating }),
  useRenameConversation: () => ({ mutate: mocks.renameMutate }),
  useDeleteConversation: () => ({ mutate: mocks.deleteMutate }),
}));

vi.mock('@/features/chat/session-list', () => ({
  SessionList: ({ sessions, onSelect }: { sessions: Array<{ id: string }>; onSelect: (id: string) => void }) => (
    <div>
      {sessions.map((session) => (
        <button key={session.id} onClick={() => onSelect(session.id)}>{session.id}</button>
      ))}
    </div>
  ),
}));

vi.mock('@/features/chat/chat-window', () => ({
  ChatWindow: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="chat-window">{conversationId}</div>
  ),
}));

vi.mock('@/features/chat/new-session-dialog', () => ({
  NewSessionDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">选择硅基员工</div> : null,
}));

describe('ChatPage 会话窗口挂载', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createMutate.mockReset();
    mocks.search = '';
    mocks.creating = false;
    mocks.sessions = [
      { id: 'archived-session', employee: { status: 'ARCHIVED' } },
      { id: 'active-session-1', employee: { status: 'APPROVED' } },
      { id: 'active-session-2', employee: { status: 'APPROVED' } },
    ];
  });

  it('从员工面板进入时直接创建该员工的会话，严格模式下不重复创建或弹出选择器', () => {
    mocks.search = 'employeeId=employee-2&source=employees';
    mocks.createMutate.mockImplementation((_input, options) => options.onSuccess({ id: 'new-session' }));

    const { rerender } = render(<StrictMode><ChatPage /></StrictMode>);

    expect(mocks.createMutate).toHaveBeenCalledTimes(1);
    expect(mocks.createMutate.mock.calls[0][0]).toEqual({ employeeId: 'employee-2' });
    expect(screen.getByTestId('chat-window')).toHaveTextContent('new-session');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith('/chat?source=employees', { scroll: false });

    rerender(<StrictMode><ChatPage /></StrictMode>);
    expect(mocks.createMutate).toHaveBeenCalledTimes(1);
  });

  it('只加载当前会话详情，并在切换时仍只保留一个窗口', () => {
    render(<ChatPage />);

    expect(screen.getAllByTestId('chat-window')).toHaveLength(1);
    expect(screen.getByTestId('chat-window')).toHaveTextContent('active-session-1');

    fireEvent.click(screen.getByRole('button', { name: 'active-session-2' }));

    expect(screen.getAllByTestId('chat-window')).toHaveLength(1);
    expect(screen.getByTestId('chat-window')).toHaveTextContent('active-session-2');
  });
});
