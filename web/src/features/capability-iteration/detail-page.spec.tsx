import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CapabilityIterationDetailPage from '@/app/(enterprise)/capabilities/[capabilityId]/page';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import type { VersionTimeline } from './use-capability-iteration';

const mocks = vi.hoisted(() => ({ timeline: vi.fn(), tab: 'versions' }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ capabilityId: 'cap' }),
  useSearchParams: () => new URLSearchParams({ tab: mocks.tab }),
}));
vi.mock('@/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...original, api: { ...original.api, get: vi.fn() } };
});
vi.mock('./use-capability-iteration', async (importOriginal) => {
  const original = await importOriginal<typeof import('./use-capability-iteration')>();
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    ...original,
    useVersionTimeline: mocks.timeline,
    useSelectPersonalVersion: mutation,
    useSelectEffectiveVersion: mutation,
    useCreatePersonalVersion: mutation,
    useUpdatePersonalVersion: mutation,
    useDiscardPersonalVersion: mutation,
    usePersonalDiffs: () => ({ data: { canManage: true, items: [], myWorkingCopy: null, total: 0, page: 1, limit: 20 } }),
  };
});
vi.mock('@/features/skill-version/use-skill-version', () => ({
  useSubmitPlatformSkillReview: () => ({ mutate: vi.fn(), isPending: false }),
  useReviewEnterprisePersonalSkillVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));

const clients: QueryClient[] = [];
function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><CapabilityIterationDetailPage /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tab = 'versions';
  useAuthStore.setState({ user: { id: 'admin', name: '管理员', email: 'admin@example.test', avatar: null, role: 'USER' } });
  const timeline: VersionTimeline = {
    capability: { id: 'cap', name: '未授权企业技能', description: '企业历史技能' },
    canManage: true, subscriptions: [], subscriptionId: '', selectedAt: null,
    currentVersionId: 'enterprise', myPersonalVersionId: null,
    versions: [{
      id: 'enterprise', capabilityId: 'cap', scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED',
      version: '1.0.0', enterpriseId: 'ent', parentVersionId: null, sourceVersionId: null,
      changeSummary: '企业已发布正文', createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z',
      createdBy: { id: 'admin', name: '管理员' }, enterpriseReviewedBy: null, enterpriseReviewedAt: null,
      rejectionReason: null, reviews: [], hasPlatformSubmission: false, isCurrent: true,
    }],
  };
  mocks.timeline.mockReturnValue({ data: timeline, isLoading: false, isError: false });
});
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); });

describe('无授权技能详情的局部错误边界', () => {
  it('usage返回403只显示局部权限状态，企业历史及改动面板仍可访问', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, '无使用授权'));
    renderDetail();
    expect(screen.getByText('企业版 1.0.0')).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '使用' }));
    expect(await screen.findByText('暂无使用记录查看权限')).toBeVisible();
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/enterprise/capabilities/cap/usage');
    expect(screen.getByRole('heading', { name: '未授权企业技能' })).toBeVisible();
    expect(screen.queryByText('无使用授权')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '版本' }));
    expect(screen.getByText('企业版 1.0.0')).toBeVisible();
    expect(screen.queryByRole('button', { name: /设为个人使用|跟随企业/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '大家的改动' }));
    expect(screen.getByRole('button', { name: '创建我的副本' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '审核状态' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: '未授权企业技能' })).toBeVisible();
  });

  it('其他usage错误仍显示局部加载失败，不替换详情导航', async () => {
    mocks.tab = 'usage';
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, '服务异常'));
    renderDetail();
    expect(await screen.findByText('使用记录加载失败')).toBeVisible();
    expect(screen.getByRole('button', { name: '版本' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: '未授权企业技能' })).toBeVisible();
  });
});
