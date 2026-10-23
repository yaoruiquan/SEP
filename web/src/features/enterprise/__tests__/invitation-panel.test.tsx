import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitationPanel } from '../invitation-panel';
import type { CreatedInvitation, EnterpriseInvitation } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  invitations: [] as EnterpriseInvitation[],
}));

vi.mock('../use-enterprise', () => ({
  useInvitations: () => ({ data: mocks.invitations, isLoading: false }),
  useCreateInvitation: () => ({ mutate: mocks.create, isPending: false }),
  useResendInvitation: () => ({ mutate: mocks.resend, isPending: false }),
  useRevokeInvitation: () => ({ mutate: mocks.revoke, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const invitation = (overrides: Partial<CreatedInvitation> = {}): CreatedInvitation => ({
  id: 'invitation-1',
  email: 'newhire@example.com',
  role: 'MEMBER',
  position: null,
  status: 'PENDING',
  emailStatus: 'SENT',
  emailLastAttemptAt: new Date().toISOString(),
  emailSentAt: new Date().toISOString(),
  emailError: null,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
  department: null,
  token: 'secret-token',
  invitationUrl: 'https://sep.example/join?token=secret-token',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invitations = [];
});
afterEach(() => vi.useRealTimers());

describe('InvitationPanel', () => {
  it('uses the shared invitation schema before submitting', () => {
    render(<InvitationPanel depts={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));

    fireEvent.click(screen.getByRole('button', { name: '发送邀请邮件' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('member@company.com'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送邀请邮件' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('shows a successful email result and keeps the link as an explicit fallback', async () => {
    render(<InvitationPanel depts={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));
    fireEvent.change(screen.getByPlaceholderText('member@company.com'), {
      target: { value: 'newhire@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送邀请邮件' }));

    expect(mocks.create).toHaveBeenCalledWith(
      { email: 'newhire@example.com', role: 'MEMBER' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    const options = mocks.create.mock.calls[0][1];
    act(() => options.onSuccess(invitation()));

    expect(await screen.findByText('邀请邮件已发送')).toBeInTheDocument();
    expect(screen.getByText(/邮件服务器已接收发送请求/)).toBeInTheDocument();
    expect(screen.queryByText('https://sep.example/join?token=secret-token')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看备用链接/ }));
    expect(screen.getByText('https://sep.example/join?token=secret-token')).toBeInTheDocument();
  });

  it('confirms resending a fresh link and explains the old link will expire', async () => {
    mocks.invitations = [{
      ...invitation({ status: 'EXPIRED', emailStatus: 'FAILED', emailLastAttemptAt: null, emailSentAt: null }),
    }];
    render(<InvitationPanel depts={[]} />);

    fireEvent.click(screen.getByTitle('重新发送邀请邮件'));
    expect(screen.getByText(/有效期重置为 7 天；原链接会立即失效/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认重发' }));

    expect(mocks.resend).toHaveBeenCalledWith('invitation-1', expect.objectContaining({ onSuccess: expect.any(Function) }));
    act(() => mocks.resend.mock.calls[0][1].onSuccess(invitation({ emailStatus: 'FAILED' })));
    expect(await screen.findByText('邀请已创建，邮件发送失败')).toBeInTheDocument();
  });

  it('disables resend during the cooldown and restores it afterwards', () => {
    vi.useFakeTimers();
    mocks.invitations = [{
      ...invitation({ emailLastAttemptAt: new Date().toISOString() }),
    }];
    render(<InvitationPanel depts={[]} />);

    expect(screen.getByTitle(/请稍后重试/)).toBeDisabled();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByTitle('重新发送邀请邮件')).toBeEnabled();
  });

  it.each([
    ['FAILED', '邀请已创建，邮件发送失败'],
    ['NOT_CONFIGURED', '邀请已创建，邮件服务未配置'],
  ] as const)('shows the fallback immediately for %s', async (emailStatus, title) => {
    render(<InvitationPanel depts={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));
    fireEvent.change(screen.getByPlaceholderText('member@company.com'), { target: { value: 'newhire@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '发送邀请邮件' }));
    act(() => mocks.create.mock.calls[0][1].onSuccess(invitation({ emailStatus })));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText('https://sep.example/join?token=secret-token')).toBeInTheDocument();
  });
});
