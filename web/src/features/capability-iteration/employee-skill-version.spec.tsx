import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeDetailPage from '@/app/(enterprise)/my-employees/[id]/page';
import { ThemeProvider } from '@/lib/theme-provider';

const mocks = vi.hoisted(() => ({ skills: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'sub-1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-store', () => ({ useAuthStore: () => ({ roleInEnterprise: 'ENTERPRISE_ADMIN' }) }));
vi.mock('@/features/subscription/use-subscriptions', () => ({
  useSubscription: () => ({ data: { id: 'sub-1', name: '员工', status: 'ACTIVE', config: {}, employee: { id: 'employee', name: '员工', avatar: null } } }),
  useUpdateSubscription: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/features/enterprise/use-enterprise', () => ({ useSubscriptionGrants: () => ({ data: [] }) }));
vi.mock('@/features/employee/use-employee-detail', () => ({
  useEmployeeDetail: () => ({ data: { capabilities: [{ id: 'skill', name: '测试技能', type: 'SKILL', order: 0 }] } }),
}));
vi.mock('@/features/employee/use-employee-usage', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/employee/use-employee-usage')>(),
  useEmployeeUsage: () => ({ data: { items: [], total: 0, members: [] } }),
  useEmployeeUsageDetail: () => ({ data: undefined }),
}));
vi.mock('@/features/skill-version/use-skill-version', () => ({ useEmployeeSkillVersions: mocks.skills }));
vi.mock('@/features/skill-version/SkillVersionPreviewDialog', () => ({
  SkillVersionPreviewDialog: ({ versionId }: { versionId: string }) => <div role="dialog">{versionId}</div>,
}));

const personal = { id: 'old-pin', scope: 'PERSONAL', version: '0.0.0-personal' };
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

function setup(enterpriseVersion: unknown, currentVersion: unknown) {
  mocks.skills.mockReturnValue({ data: { skills: [{ capability: { id: 'skill' }, enterpriseVersion, currentVersion, versions: [] }] } });
  render(<ThemeProvider><EmployeeDetailPage /></ThemeProvider>);
  fireEvent.mouseDown(screen.getByRole('tab', { name: '能力' }));
}

describe('员工详情企业启用版本', () => {
  it('企业版本优先于历史个人PIN，预览同一启用版本且无正文写入/个人选版入口', () => {
    setup({ id: 'enabled', scope: 'ENTERPRISE', version: '2.0.0' }, personal);
    expect(screen.getByText('企业当前启用 v2.0.0 · 企业')).toBeInTheDocument();
    expect(screen.queryByText(/0.0.0-personal/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /创建企业|创建新版/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /企业默认版本/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '选择我的使用版本' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看内容' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('enabled');
  });

  it('不把旧个人currentVersion误标成企业启用，无启用版本仍可查看提交历史', () => {
    setup(null, personal);
    expect(screen.getByText('暂无启用版本')).toBeInTheDocument();
    expect(screen.queryByText(/企业当前启用/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看内容' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看版本与审核历史' })).toHaveAttribute('href', '/capabilities/skill');
  });

  it('兼容只有平台currentVersion的旧响应', () => {
    setup(null, { id: 'platform', scope: 'PLATFORM', version: '1.0.0' });
    expect(screen.getByText('企业当前启用 v1.0.0 · 平台')).toBeInTheDocument();
  });
});
