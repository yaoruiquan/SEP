import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAuthStore } from '@/lib/auth-store';
import { AccountClosureFlow } from './account-closure-flow';

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  eligibility: {
    data: {
      eligible: true,
      enterprisesToClose: [] as { id: string; name: string }[],
      blockers: [] as { code: string; message: string }[],
    },
    isLoading: false,
    error: null,
  },
  request: { mutate: vi.fn(), isPending: false, isSuccess: false, error: null },
  submit: { mutate: vi.fn(), isPending: false, error: null },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(mocks.token ? { token: mocks.token } : {}),
}));
vi.mock('./use-auth', () => ({
  useAccountClosureEligibility: () => mocks.eligibility,
  useRequestAccountClosureVerification: () => mocks.request,
  useSubmitAccountClosure: () => mocks.submit,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.token = null;
  mocks.eligibility.data = {
    eligible: true,
    enterprisesToClose: [],
    blockers: [],
  };
  mocks.request.isSuccess = false;
  mocks.submit.isPending = false;
  useAuthStore.setState({
    hydrated: true,
    user: {
      id: 'user',
      email: 'test@example.com',
      name: null,
      avatar: null,
      role: 'USER',
    },
    enterprise: null,
  });
});

describe('AccountClosureFlow', () => {
  it('waits for identity hydration', () => {
    useAuthStore.setState({ hydrated: false });
    render(<AccountClosureFlow />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('retains the token when requiring login', () => {
    mocks.token = 'a'.repeat(32);
    useAuthStore.setState({ user: null });
    render(<AccountClosureFlow />);
    expect(screen.getByRole('link', { name: '返回登录' })).toHaveAttribute(
      'href',
      `/login?redirect=${encodeURIComponent(`/account-closure?token=${mocks.token}`)}`,
    );
  });
  it('shows blockers and prevents email verification', () => {
    mocks.eligibility.data = {
      eligible: false,
      enterprisesToClose: [],
      blockers: [
        { code: 'MEMBERSHIP', message: '企业还有其他成员，请先退出企业' },
      ],
    };
    render(<AccountClosureFlow />);
    expect(
      screen.getByText('企业还有其他成员，请先退出企业'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '发送注销验证邮件' }),
    ).toBeDisabled();
  });
  it('names enterprises that will close together and warns that closure is immediate', () => {
    mocks.eligibility.data.enterprisesToClose = [
      { id: 'enterprise', name: '本人企业' },
    ];
    render(<AccountClosureFlow />);
    expect(screen.getByText('本人企业')).toBeInTheDocument();
    expect(screen.getByText(/将同时关闭/)).toBeInTheDocument();
    expect(screen.getByText(/账号立即注销且无法恢复/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '发送注销验证邮件' }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('link', { name: /撤销/ }),
    ).not.toBeInTheDocument();
  });
  it('opening verification link alone does not mutate; exact confirmation is required', () => {
    mocks.token = 'a'.repeat(32);
    render(<AccountClosureFlow />);
    const button = screen.getByRole('button', { name: '确认立即注销' });
    expect(button).toBeDisabled();
    expect(mocks.submit.mutate).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByRole('textbox', { name: '输入“注销账号”以确认立即注销' }),
      { target: { value: '注销账号' } },
    );
    fireEvent.click(button);
    expect(mocks.submit.mutate).toHaveBeenCalledWith(
      { token: mocks.token, confirmation: '注销账号' },
      expect.any(Object),
    );
  });
  it('blocks confirmation when current eligibility no longer allows closure', () => {
    mocks.token = 'a'.repeat(32);
    mocks.eligibility.data.eligible = false;
    render(<AccountClosureFlow />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '注销账号' },
    });
    expect(screen.getByRole('button', { name: '确认立即注销' })).toBeDisabled();
  });
  it('disables confirmation and editing while closure is in progress', () => {
    mocks.token = 'a'.repeat(32);
    const { rerender } = render(<AccountClosureFlow />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '注销账号' } });
    mocks.submit.isPending = true;
    rerender(<AccountClosureFlow />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认立即注销' })).toBeDisabled();
  });
  it('shows completed account and enterprise closure even after auth is cleared', () => {
    mocks.token = 'a'.repeat(32);
    mocks.submit.mutate.mockImplementation((_body, options) => {
      useAuthStore.setState({ user: null });
      options.onSuccess({
        status: 'CLOSED',
        closedAt: '2026-10-23T01:00:00Z',
        closedEnterprises: [{ id: 'enterprise', name: '已关闭企业' }],
      });
    });
    render(<AccountClosureFlow />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '注销账号' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认立即注销' }));
    expect(screen.getByText('账号已注销')).toBeInTheDocument();
    expect(screen.getByText('已关闭企业')).toBeInTheDocument();
    expect(screen.queryByText(/预计生效时间/)).not.toBeInTheDocument();
  });
});
