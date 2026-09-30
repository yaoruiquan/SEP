import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegisterPage from './page';
import { api } from '@/lib/api-client';

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/features/auth/oauth-provider-buttons', () => ({
  OAuthProviderButtons: () => null,
}));

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), get: vi.fn() } };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RegisterPage />
    </QueryClientProvider>,
  );
}

function fillRegistration({ confirmPassword = 'password123' } = {}) {
  fireEvent.change(screen.getByPlaceholderText('你的公司'), { target: { value: '新公司' } });
  fireEvent.change(screen.getByPlaceholderText('你的名字'), { target: { value: '张三' } });
  fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('输入 6 位验证码'), { target: { value: '123456' } });
  fireEvent.change(screen.getByPlaceholderText('至少 8 位'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByPlaceholderText('再次输入密码'), { target: { value: confirmPassword } });
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not submit when password confirmation differs', async () => {
    renderPage();
    fillRegistration({ confirmPassword: 'different123' });

    fireEvent.click(screen.getByRole('button', { name: '注册并开通企业' }));

    expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith('/auth/register', expect.anything(), expect.anything());
  });

  it('sends the code to the entered email and excludes confirmation from the registration payload', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ message: '如果该邮箱可用于注册，验证码将发送至该邮箱' })
      .mockResolvedValueOnce({
        token: 'access-token',
        user: { id: 'user-1', email: 'new@example.com', name: '张三', avatar: null, role: 'USER' },
        enterprise: { id: 'enterprise-1', name: '新公司' },
        roleInEnterprise: 'ENTERPRISE_ADMIN',
      });
    renderPage();
    fillRegistration();

    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/auth/registration/email-code',
      { email: 'new@example.com' },
      { skipAuthRetry: true },
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('如果该邮箱可用于注册');

    fireEvent.click(screen.getByRole('button', { name: '注册并开通企业' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/auth/register',
      {
        email: 'new@example.com',
        emailCode: '123456',
        password: 'password123',
        enterpriseName: '新公司',
        name: '张三',
      },
      { skipAuthRetry: true },
    ));
    expect(JSON.stringify(vi.mocked(api.post).mock.calls)).not.toContain('confirmPassword');
  });
});
