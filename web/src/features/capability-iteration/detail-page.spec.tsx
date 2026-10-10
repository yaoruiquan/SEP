import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CapabilityIterationDetailPage from '@/app/(enterprise)/capabilities/[capabilityId]/page';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import type { SkillSubmissionDetail, VersionTimeline } from './use-capability-iteration';

const mocks = vi.hoisted(() => ({ timeline: vi.fn(), tab: 'versions', submissionId: '' }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ capabilityId: 'cap' }),
  useSearchParams: () => new URLSearchParams({ tab: mocks.tab, ...(mocks.submissionId ? { submission: mocks.submissionId } : {}) }),
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
  mocks.submissionId = '';
  window.history.replaceState(null, '', '/capabilities/cap');
  useAuthStore.setState({
    user: { id: 'admin', name: '管理员', email: 'admin@example.test', avatar: null, role: 'USER' },
    enterprise: { id: 'ent', name: '测试企业' }, roleInEnterprise: 'ENTERPRISE_ADMIN',
  });
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
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  useAuthStore.setState({ user: null, enterprise: null, roleInEnterprise: null });
});

describe('无授权技能详情的局部错误边界', () => {
  it('usage返回403只显示局部权限状态，企业历史及改动面板仍可访问', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, '无使用授权'));
    renderDetail();
    expect(screen.getAllByText('企业版 1.0.0')).toHaveLength(2);
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('tab', { name: '使用统计' }), { button: 0, ctrlKey: false });
    expect(await screen.findByText('暂无使用记录查看权限')).toBeVisible();
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/enterprise/capabilities/cap/usage');
    expect(screen.getByRole('heading', { name: '未授权企业技能' })).toBeVisible();
    expect(screen.getByRole('region', { name: '企业当前启用' })).toBeVisible();
    expect(screen.queryByText('无使用授权')).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: '发布版本' }), { button: 0, ctrlKey: false });
    expect(screen.getAllByText('企业版 1.0.0')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /设为个人使用|跟随企业/ })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: '提交与审核' }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole('button', { name: '创建我的副本' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '审核状态' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: '未授权企业技能' })).toBeVisible();
  });

  it('其他usage错误仍显示局部加载失败，不替换详情导航', async () => {
    mocks.tab = 'usage';
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, '服务异常'));
    renderDetail();
    expect(await screen.findByText('使用记录加载失败')).toBeVisible();
    expect(screen.getByRole('tab', { name: '发布版本' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: '未授权企业技能' })).toBeVisible();
    expect(screen.getByRole('region', { name: '企业当前启用' })).toBeVisible();
  });

  it('角色降级重建已打开的详情，403时不残留管理员snapshot正文及审核入口', async () => {
    mocks.tab = 'changes';
    mocks.submissionId = 'sub-1';
    const detail: SkillSubmissionDetail = {
      canManage: true, source: null, sourceState: 'NONE', currentBaseline: null,
      currentBaselineState: 'NONE', reviews: [],
      item: {
        id: 'sub-1', version: '1.0.0', owner: { id: 'other-user', name: '其他成员', email: 'other@example.test' },
        changeSummary: '仅管理员可见提交标题', content: '其他成员保密正文', basedOn: null,
        updatedAt: '2026-10-09T00:00:00Z', submittedAt: '2026-10-09T00:00:00Z',
        adopted: false, adoptedAt: null, pending: true, status: 'PENDING_ENTERPRISE_REVIEW',
        reviewStatus: 'PENDING_ENTERPRISE_REVIEW', enterpriseReviewedAt: null, reviewedBy: null,
        rejectionReason: null, publishedVersionId: null, isWorkingCopy: false, canEdit: false, isLegacyUnpublished: false,
      },
    };
    let rejectMember!: (reason: ApiError) => void;
    const memberRequest = new Promise<never>((_resolve, reject) => { rejectMember = reject; });
    vi.mocked(api.get).mockResolvedValueOnce(detail).mockReturnValueOnce(memberRequest);
    renderDetail();
    expect(await screen.findByRole('heading', { name: '仅管理员可见提交标题' })).toBeVisible();
    fireEvent.mouseDown(screen.getByRole('tab', { name: '完整内容' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('其他成员保密正文')).toBeVisible();
    expect(screen.getByRole('button', { name: '通过并启用' })).toBeVisible();
    act(() => { useAuthStore.setState({ roleInEnterprise: 'MEMBER' }); });
    expect(screen.queryByText('其他成员保密正文')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '仅管理员可见提交标题' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过并启用' })).not.toBeInTheDocument();
    await act(async () => { rejectMember(new ApiError(403, '无查看权限')); });
    expect(await screen.findByText('无查看权限')).toBeVisible();
    expect(screen.queryByText('其他成员保密正文')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过并启用' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenNthCalledWith(1, '/enterprise/capabilities/cap/submissions/sub-1');
    expect(api.get).toHaveBeenNthCalledWith(2, '/enterprise/capabilities/cap/submissions/sub-1');
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
