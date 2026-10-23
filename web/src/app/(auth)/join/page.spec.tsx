import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JoinPage from './page';
import { useAuthStore } from '@/lib/auth-store';

const mocks = vi.hoisted(() => ({
  registerInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  mutate: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  nextAction: 'REGISTER' as string | undefined,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=invite-token'),
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/features/auth/oauth-provider-buttons', () => ({
  OAuthProviderButtons: () => null,
}));

vi.mock('@/features/auth/use-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth/use-auth')>();
  return {
    ...actual,
    useVerifyInvitation: () => ({
      data: {
        email: 'invited@example.com',
        nextAction: mocks.nextAction,
        role: 'MEMBER',
        department: null,
        position: null,
        expiresAt: '2026-10-01T00:00:00.000Z',
        enterprise: { id: 'enterprise-1', name: '受邀企业' },
      },
      isLoading: false,
      error: null,
    }),
    useRegisterByInvitation: mocks.registerInvitation,
    useAcceptInvitation: mocks.acceptInvitation,
  };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <JoinPage />
    </QueryClientProvider>,
  );
}

function fillInvitation({ confirmPassword = 'password123' } = {}) {
  fireEvent.change(screen.getByPlaceholderText('你的名字'), { target: { value: '李四' } });
  fireEvent.change(screen.getByPlaceholderText('输入 6 位验证码'), { target: { value: '654321' } });
  fireEvent.change(screen.getByPlaceholderText('至少 8 位'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByPlaceholderText('再次输入密码'), { target: { value: confirmPassword } });
}

describe('JoinPage registration form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nextAction = 'REGISTER';
    mocks.registerInvitation.mockReturnValue({ mutate: mocks.mutate, isPending: false, error: null });
    mocks.acceptInvitation.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
    useAuthStore.setState({
      token: null,
      user: null,
      enterprise: null,
      roleInEnterprise: null,
      hydrated: true,
    });
  });

  it('requires matching password confirmation before joining', async () => {
    renderPage();
    fillInvitation({ confirmPassword: 'different123' });

    fireEvent.click(screen.getByRole('button', { name: '设置密码并加入' }));

    expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('submits the invitation email code but not confirmation password', async () => {
    renderPage();
    fillInvitation();

    fireEvent.click(screen.getByRole('button', { name: '设置密码并加入' }));

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledWith({
      token: 'invite-token',
      email: 'invited@example.com',
      emailCode: '654321',
      password: 'password123',
      name: '李四',
    }));
    expect(JSON.stringify(mocks.mutate.mock.calls)).not.toContain('confirmPassword');
  });

  it('sends an existing account to login instead of requesting a registration code', () => {
    mocks.nextAction = 'LOGIN';
    renderPage();

    expect(screen.getByText('该邮箱已有账号')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入 6 位验证码')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设置密码并加入' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录并接受邀请' })).toHaveAttribute(
      'href', '/login?redirect=%2Fjoin%3Ftoken%3Dinvite-token',
    );
  });

  it('blocks registration for an unavailable invited account', () => {
    mocks.nextAction = 'CONTACT_SUPPORT';
    renderPage();

    expect(screen.getByText('该账号暂不可用')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入 6 位验证码')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '登录并接受邀请' })).not.toBeInTheDocument();
  });

  it('does not guess registration when the server omits the next action', () => {
    mocks.nextAction = undefined;
    renderPage();

    expect(screen.getByText('邀请信息暂未更新，请刷新页面后重试。')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入 6 位验证码')).not.toBeInTheDocument();
  });

  it('waits for authentication recovery before showing a registration form', () => {
    useAuthStore.setState({ hydrated: false });
    renderPage();

    expect(screen.queryByPlaceholderText('输入 6 位验证码')).not.toBeInTheDocument();
  });

  it('offers the enterprise entrance to an existing member of the invited enterprise', () => {
    mocks.nextAction = 'LOGIN';
    useAuthStore.setState({
      token: 'access-token',
      user: { id: 'user-1', email: 'invited@example.com', name: null, avatar: null, role: 'USER' },
      enterprise: { id: 'enterprise-1', name: '受邀企业' },
    });
    renderPage();

    expect(screen.getByText('你已是该企业成员')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入企业' })).toHaveAttribute('href', '/dashboard');
    expect(screen.queryByText(/请先在个人设置里退出当前企业/)).not.toBeInTheDocument();
  });

  it('preserves the invitation when directing an affiliated user to leave their enterprise', () => {
    mocks.nextAction = 'LOGIN';
    useAuthStore.setState({
      token: 'access-token',
      user: { id: 'user-1', email: 'invited@example.com', name: null, avatar: null, role: 'USER' },
      enterprise: { id: 'enterprise-old', name: '原企业' },
    });
    renderPage();

    expect(screen.getByRole('link', { name: '去个人设置' })).toHaveAttribute(
      'href', '/settings/profile?invitationToken=invite-token',
    );
    expect(screen.getByText(/无需注销账号/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /以 invited@example.com 加入/ })).toBeDisabled();
  });

  it('keeps the invitation when the signed-in email does not match', () => {
    mocks.nextAction = 'LOGIN';
    useAuthStore.setState({
      token: 'access-token',
      user: { id: 'user-other', email: 'other@example.com', name: null, avatar: null, role: 'USER' },
    });
    renderPage();

    expect(screen.getByText('当前登录的不是被邀请的账号')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /用 invited@example.com 登录/ })).toHaveAttribute(
      'href', '/login?redirect=%2Fjoin%3Ftoken%3Dinvite-token',
    );
    expect(screen.getByRole('button', { name: /以 other@example.com 加入/ })).toBeDisabled();
  });
});
