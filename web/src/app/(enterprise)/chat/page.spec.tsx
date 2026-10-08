import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatPage from './page';

const mocks = vi.hoisted(() => ({
  sessions: [] as Array<any>,
  createMutate: vi.fn(),
  renameMutate: vi.fn(),
  deleteMutate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/features/chat/use-conversations', () => ({
  useConversations: () => ({ data: mocks.sessions, isLoading: false }),
  useCreateConversation: () => ({ mutate: mocks.createMutate, isPending: false }),
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
  NewSessionDialog: () => null,
}));

describe('ChatPage 会话窗口挂载', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions = [
      { id: 'archived-session', employee: { status: 'ARCHIVED' } },
      { id: 'active-session-1', employee: { status: 'APPROVED' } },
      { id: 'active-session-2', employee: { status: 'APPROVED' } },
    ];
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
