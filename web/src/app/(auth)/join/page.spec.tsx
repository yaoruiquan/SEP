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
});
