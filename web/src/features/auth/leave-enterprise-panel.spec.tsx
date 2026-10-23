import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LeaveEnterprisePanel } from './leave-enterprise-panel';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';

const mocks = vi.hoisted(() => ({ useLeaveEnterprise: vi.fn(), mutate: vi.fn() }));

vi.mock('./use-auth', () => ({ useLeaveEnterprise: mocks.useLeaveEnterprise }));

describe('LeaveEnterprisePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useLeaveEnterprise.mockReturnValue({ mutate: mocks.mutate, isPending: false, error: null });
    useAuthStore.setState({ enterprise: { id: 'old-enterprise', name: '原企业' }, roleInEnterprise: 'MEMBER' });
  });

  it('requires explicit confirmation and allows cancellation before submitting', () => {
    render(<LeaveEnterprisePanel invitationToken="invite-token" />);

    expect(mocks.useLeaveEnterprise).toHaveBeenCalledWith('invite-token');
    expect(screen.getByText(/退出成功后将返回邀请页面/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退出「原企业」' }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('button', { name: '确认退出' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退出「原企业」' }));
    fireEvent.click(screen.getByRole('button', { name: '确认退出' }));
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });

  it('explains administrator handover and shows a refusal from the backend', () => {
    useAuthStore.setState({ roleInEnterprise: 'ENTERPRISE_ADMIN' });
    mocks.useLeaveEnterprise.mockReturnValue({
      mutate: mocks.mutate,
      isPending: false,
      error: new ApiError(409, '你是本企业唯一的管理员，请先指定其他管理员，再办理离职'),
    });
    render(<LeaveEnterprisePanel />);

    expect(screen.getByText(/需先指定另一位管理员才能退出/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('你是本企业唯一的管理员');
  });

  it('disables confirmation and cancellation while leaving is in progress', () => {
    const { rerender } = render(<LeaveEnterprisePanel />);
    fireEvent.click(screen.getByRole('button', { name: '退出「原企业」' }));
    mocks.useLeaveEnterprise.mockReturnValue({ mutate: mocks.mutate, isPending: true, error: null });
    rerender(<LeaveEnterprisePanel />);

    expect(screen.getByRole('button', { name: '确认退出' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });

  it('handles enterprise identity appearing during authentication recovery', () => {
    useAuthStore.setState({ enterprise: null });
    render(<LeaveEnterprisePanel />);
    expect(screen.queryByText('退出企业')).not.toBeInTheDocument();

    act(() => useAuthStore.setState({ enterprise: { id: 'old-enterprise', name: '原企业' } }));

    expect(screen.getByRole('button', { name: '退出「原企业」' })).toBeInTheDocument();
  });
});
