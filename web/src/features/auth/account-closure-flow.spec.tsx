import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAuthStore } from '@/lib/auth-store';
import {
  AccountClosureCancelFlow,
  AccountClosureFlow,
  AccountClosureRecoveryFlow,
} from './account-closure-flow';

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  eligibility: {
    data: {
      eligible: true,
      gracePeriodDays: 7,
      blockers: [] as { code: string; message: string }[],
    },
    isLoading: false,
    error: null,
  },
  request: { mutate: vi.fn(), isPending: false, isSuccess: false, error: null },
  submit: { mutate: vi.fn(), isPending: false, error: null },
  cancel: { mutate: vi.fn(), isPending: false, error: null },
  cancelPreview: {
    data: {
      scheduledFor: '2026-10-30T01:00:00Z',
      status: 'PENDING',
      canCancel: true,
    },
    isLoading: false,
    error: null,
  },
  recovery: {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null,
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(mocks.token ? { token: mocks.token } : {}),
}));
vi.mock('./use-auth', () => ({
  useAccountClosureEligibility: () => mocks.eligibility,
  useRequestAccountClosureVerification: () => mocks.request,
  useSubmitAccountClosure: () => mocks.submit,
  useCancelAccountClosure: () => mocks.cancel,
  useAccountClosureCancellationPreview: () => mocks.cancelPreview,
  useRecoverAccountClosure: () => mocks.recovery,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = null;
  mocks.eligibility.data = { eligible: true, gracePeriodDays: 7, blockers: [] };
  mocks.request.isSuccess = false;
  mocks.submit.isPending = false;
  mocks.cancelPreview.error = null;
  mocks.cancelPreview.isLoading = false;
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
  it('waits for authentication hydration', () => {
    useAuthStore.setState({ hydrated: false });
    render(<AccountClosureFlow />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('preserves verification token when requiring login', () => {
    mocks.token = 'a'.repeat(32);
    useAuthStore.setState({ user: null });
    render(<AccountClosureFlow />);
    expect(screen.getByRole('link', { name: '返回登录' })).toHaveAttribute(
      'href',
      `/login?redirect=${encodeURIComponent(`/account-closure?token=${mocks.token}`)}`,
    );
  });

  it('blocks verification while eligibility has outstanding membership', () => {
    mocks.eligibility.data = {
      eligible: false,
      gracePeriodDays: 7,
      blockers: [{ code: 'MEMBERSHIP', message: '请先退出企业' }],
    };
    render(<AccountClosureFlow />);
    expect(screen.getByText('请先退出企业')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '发送注销验证邮件' }),
    ).toBeDisabled();
  });

  it('requires exact confirmation and submits only after explicit action', () => {
    mocks.token = 'a'.repeat(32);
    render(<AccountClosureFlow />);
    expect(mocks.submit.mutate).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: '提交注销申请' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '注销账号确认' }), {
      target: { value: '注销账号' },
    });
    fireEvent.click(button);
    expect(mocks.submit.mutate).toHaveBeenCalledWith(
      { token: mocks.token, confirmation: '注销账号' },
      expect.any(Object),
    );
  });

  it('shows success after logout clears the user', () => {
    mocks.token = 'a'.repeat(32);
    mocks.submit.mutate.mockImplementation((_body, options) => {
      useAuthStore.setState({ user: null });
      options.onSuccess({ scheduledFor: '2026-10-30T01:00:00.000Z' });
    });
    render(<AccountClosureFlow />);
    fireEvent.change(screen.getByRole('textbox', { name: '注销账号确认' }), {
      target: { value: '注销账号' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交注销申请' }));
    expect(screen.getByText('注销申请已提交')).toBeInTheDocument();
  });
});

describe('AccountClosureCancelFlow', () => {
  it('never cancels by simply opening a link', () => {
    mocks.token = 'b'.repeat(32);
    render(<AccountClosureCancelFlow />);
    expect(mocks.cancel.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    expect(mocks.cancel.mutate).toHaveBeenCalledWith(
      mocks.token,
      expect.any(Object),
    );
  });

  it('rejects a missing cancellation token', () => {
    render(<AccountClosureCancelFlow />);
    expect(screen.getByText('撤销链接无效')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('blocks submission while the cancellation link is being verified', () => {
    mocks.token = 'b'.repeat(32);
    mocks.cancelPreview.isLoading = true;
    render(<AccountClosureCancelFlow />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.cancel.mutate).not.toHaveBeenCalled();
  });
});

it('requests recovery through the entered mailbox', () => {
  render(<AccountClosureRecoveryFlow />);
  fireEvent.change(screen.getByRole('textbox', { name: '邮箱' }), {
    target: { value: 'test@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送撤销邮件' }));
  expect(mocks.recovery.mutate).toHaveBeenCalledWith({
    email: 'test@example.com',
  });
});

it('rejects invalid recovery addresses before sending', () => {
  render(<AccountClosureRecoveryFlow />);
  fireEvent.change(screen.getByRole('textbox', { name: '邮箱' }), {
    target: { value: 'invalid' },
  });
  expect(screen.getByRole('button', { name: '发送撤销邮件' })).toBeDisabled();
});
