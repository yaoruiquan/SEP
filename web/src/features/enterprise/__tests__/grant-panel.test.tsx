import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GrantPanel } from '../grant-panel';
import type { Subscription } from '@/lib/types';

const mocks = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), api: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ ApiError: class extends Error {}, api: { get: mocks.api, post: mocks.api } }));
vi.mock('../use-enterprise', () => ({
  useSubscriptionGrants: () => ({ data: [{ id: 'grant-1', member: { name: '张三' } }], isLoading: false }),
  useDepartments: () => ({ data: [{ id: 'dept-1', name: '研发部', children: [] }] }),
  useMembers: () => ({ data: [{ id: 'member-1', user: { name: '李四', email: 'li@example.com' } }] }),
  useCreateGrant: () => ({ mutate: mocks.create, isPending: false }),
  useDeleteGrant: () => ({ mutate: mocks.remove }),
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const subscription = { id: 'subscription-1', name: '助理' } as Subscription;
beforeEach(() => vi.clearAllMocks());

describe('员工使用授权与知识库成员权限分离', () => {
  it('保留个人和部门授权，不发起知识库请求', () => {
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: '知识库' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'member-1' } });
    fireEvent.click(screen.getByRole('button', { name: '开通授权' }));
    expect(mocks.create).toHaveBeenLastCalledWith({ subscriptionId: 'subscription-1', memberId: 'member-1' }, expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: '给部门' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dept-1' } });
    fireEvent.click(screen.getByRole('button', { name: '开通授权' }));
    expect(mocks.create).toHaveBeenLastCalledWith({ subscriptionId: 'subscription-1', departmentId: 'dept-1' }, expect.any(Object));
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('保留员工授权撤销', () => {
    render(<GrantPanel subscription={subscription} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle('收回'));
    expect(mocks.remove).toHaveBeenCalledWith({ grantId: 'grant-1', subscriptionId: 'subscription-1' }, expect.any(Object));
  });
});
