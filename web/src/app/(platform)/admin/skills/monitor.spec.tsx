import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminSkillsPage from './page';
import DetailPage from './[versionId]/page';
import { canSelectSource, creationMethodLabel, currentUsageLabel, monitorQuery, type MonitorDetail } from './monitor';

const { get, post, push, toastError } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), push: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: { get, post } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ versionId: 'source-1' }), useRouter: () => ({ push }) }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: toastError } }));
vi.mock('@/features/chat/markdown', () => ({ Markdown: ({ content }: { content: string }) => <div>{content}</div> }));

function version(overrides: Partial<MonitorDetail> = {}): MonitorDetail {
  return {
    id: 'source-1', capabilityId: 'private-cap', capability: { id: 'private-cap', name: '来源技能', description: '测试正文' },
    scope: 'PERSONAL', enterpriseId: 'enterprise-1', enterprise: { id: 'enterprise-1', name: '来源企业' },
    ownerId: 'owner-1', owner: { id: 'owner-1', name: '来源所有者' }, parentVersionId: null, sourceVersionId: null,
    version: '1.0.1', changeSummary: '客户端修改', content: '# 完整来源正文', status: 'PENDING_ENTERPRISE_REVIEW',
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T01:00:00.000Z',
    enterpriseReviewStatus: 'PENDING', platformProcessingStatus: 'NOT_SUBMITTED', ...overrides,
  };
}
function mount(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
  return client;
}
beforeEach(() => { vi.clearAllMocks(); });

describe('monitor 列表', () => {
  beforeEach(() => {
    get.mockImplementation(async (path: string) => {
      const query = new URLSearchParams(path.split('?')[1]);
      return { items: [version({ id: `page-${query.get('page')}`, status: 'ARCHIVED' })], total: 41, page: Number(query.get('page')), limit: Number(query.get('limit')) };
    });
  });
  it('默认全量含历史版本，常用筛选精简，高级筛选默认折叠', async () => {
    mount(<AdminSkillsPage />);
    expect(await screen.findByText('来源技能')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/admin/skill-versions?page=1&limit=20');
    const row = screen.getByRole('row', { name: /来源技能/ });
    expect(within(row).getByText('企业待审')).toBeInTheDocument();
    expect(within(row).getByText('未收录')).toBeInTheDocument();
    for (const label of ['来源', '企业审核', '平台收录状态']) expect(screen.getByLabelText(label)).toHaveValue('');
    expect(screen.getByLabelText('来源').querySelectorAll('option')).toHaveLength(4);
    expect(screen.getByText('高级筛选').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByLabelText('版本状态')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('产生方式')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('企业 ID')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '应用筛选' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回硅基能力' })).toHaveAttribute('href', '/admin/capabilities');
    expect(screen.queryByText(/查看个人、企业、平台的全部版本/)).not.toBeInTheDocument();
  });
  it('稳定翻页、组合筛选传服务端并重置页码，时间转 ISO', async () => {
    mount(<AdminSkillsPage />);
    await screen.findByText('来源技能');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/admin/skill-versions?page=2&limit=20'));
    fireEvent.change(screen.getByLabelText('来源'), { target: { value: 'ENTERPRISE' } });
    fireEvent.click(screen.getByText('高级筛选'));
    fireEvent.change(screen.getByLabelText('企业审核'), { target: { value: 'REJECTED' } });
    fireEvent.change(screen.getByLabelText('平台收录状态'), { target: { value: 'PENDING_REVIEW' } });
    for (const [label, value] of [['企业名称', 'e & 1'], ['提交人', '张三'], ['搜索技能', '沟通'], ['创建开始时间', '2026-10-01T00:00'], ['创建结束时间', '2026-10-09T23:59']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await waitFor(() => {
      const params = new URLSearchParams(get.mock.calls.at(-1)?.[0].split('?')[1]);
      expect(Object.fromEntries(params)).toEqual({ page: '1', limit: '20', scope: 'ENTERPRISE', enterpriseReviewStatus: 'REJECTED', platformProcessingStatus: 'PENDING_REVIEW', search: '沟通', enterpriseName: 'e & 1', ownerName: '张三', createdFrom: new Date('2026-10-01T00:00').toISOString(), createdTo: new Date('2026-10-09T23:59').toISOString() });
    });
    fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '50' } });
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toContain('page=1&limit=50'));
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/admin/skill-versions?page=1&limit=50'));
  });
  it('无效时间不发送筛选请求', async () => {
    mount(<AdminSkillsPage />);
    await screen.findByText('来源技能');
    fireEvent.click(screen.getByText('高级筛选'));
    fireEvent.change(screen.getByLabelText('创建开始时间'), { target: { value: '2026-10-09T23:59' } });
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toContain('createdFrom='));
    const count = get.mock.calls.length;
    fireEvent.change(screen.getByLabelText('创建结束时间'), { target: { value: '2026-10-01T00:00' } });
    expect(screen.getByRole('alert')).toHaveTextContent('开始时间不能晚于结束时间');
    expect(get).toHaveBeenCalledTimes(count);
  });
  it('快速输入只发送最终搜索，重置取消尚未执行的搜索', async () => {
    mount(<AdminSkillsPage />);
    await screen.findByText('来源技能');
    fireEvent.change(screen.getByLabelText('搜索技能'), { target: { value: '供' } });
    fireEvent.change(screen.getByLabelText('搜索技能'), { target: { value: '  供应商  ' } });
    expect(get).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toContain('search=%E4%BE%9B%E5%BA%94%E5%95%86'));
    expect(get).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('搜索技能'), { target: { value: '待取消' } });
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(get.mock.calls.at(-1)?.[0]).toBe('/admin/skill-versions?page=1&limit=20');
    expect(screen.getByLabelText('搜索技能')).toHaveValue('');
  });
  it('403 显示拒绝错误，重试可恢复；不暴露旧缓存操作', async () => {
    get.mockRejectedValueOnce(new Error('403 无权访问'));
    mount(<AdminSkillsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('403 无权访问');
    expect(screen.queryByRole('link', { name: '查看来源与处理' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('来源技能')).toBeInTheDocument();
  });
});

describe('monitor 详情选审', () => {
  it.each(['PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_REJECTED', 'ARCHIVED'] as const)('来源 %s 只读，收录固定 DRAFT 并刷新列表/详情后导航', async (status) => {
    get.mockResolvedValue(version({ status }));
    post.mockResolvedValue(version({ id: 'platform-1', scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW' }));
    const client = mount(<DetailPage />);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await screen.findByRole('button', { name: '收录到平台待审' });
    expect(screen.queryByRole('button', { name: /审核通过并发布|直接发布|编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /正文/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收录到平台待审' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/skills/platform-1'));
    expect(post).toHaveBeenCalledWith('/admin/skill-versions/source-1/adopt', { mode: 'DRAFT', expectedUpdatedAt: '2026-10-08T01:00:00.000Z' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['skill-versions'] });
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });
  it('平台待审只审核精确版本，驳回必须有原因且携带时间戳', async () => {
    get.mockResolvedValue(version({ scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW', sourceVersion: version(), sourceVersionId: 'origin', packageKey: 'skill.zip', packageFilename: '原始包.zip', packageSha256: 'a'.repeat(64), packageFileCount: 3 }));
    post.mockResolvedValue({});
    mount(<DetailPage />);
    await screen.findByRole('button', { name: '审核通过并发布' });
    expect(screen.getByRole('link', { name: /个人来源 v/ })).toHaveAttribute('href', '/admin/skills/source-1');
    expect(screen.getByText('原始包.zip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    expect(post).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('驳回时必须填写原因');
    fireEvent.change(screen.getByPlaceholderText('驳回时必须填写原因'), { target: { value: '  包需要补充说明  ' } });
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/skill-versions/source-1/review', { decision: 'REJECT', comment: '包需要补充说明', expectedUpdatedAt: '2026-10-08T01:00:00.000Z' }));
  });
  it('通过精确平台版本才发布，不调用 generic approve/adopt PUBLISH', async () => {
    get.mockResolvedValue(version({ scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW' })); post.mockResolvedValue({});
    mount(<DetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: '审核通过并发布' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/skills'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual(['/admin/skill-versions/source-1/review', { decision: 'APPROVE', expectedUpdatedAt: '2026-10-08T01:00:00.000Z' }]);
  });
  it('历史副本快照复用平台记录；驳回在原平台版本重新送审并 refetch', async () => {
    const platform = version({ id: 'platform-1', scope: 'PLATFORM', status: 'PLATFORM_REJECTED' });
    get.mockResolvedValue(version({ isWorkingCopy: true, reviewSnapshots: [{ ...version(), workingCopyUpdatedAt: version().updatedAt, promotedVersions: [platform] }] }));
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><DetailPage /></QueryClientProvider>);
    expect(await screen.findByRole('link', { name: /查看平台版本/ })).toHaveAttribute('href', '/admin/skills/platform-1');
    expect(screen.queryByRole('button', { name: '收录到平台待审' })).not.toBeInTheDocument();
    unmount();
    get.mockResolvedValue(platform); post.mockResolvedValue(platform);
    mount(<DetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: '提交平台审核' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/skill-versions/source-1/submit-review', { expectedUpdatedAt: version().updatedAt }));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(2));
    expect(post.mock.calls.some(([path]) => path.endsWith('/adopt'))).toBe(false);
  });
  it('选审 403 保留来源，展示错误且不导航', async () => {
    get.mockResolvedValue(version()); post.mockRejectedValue(new Error('403 无权选审'));
    mount(<DetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: '收录到平台待审' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('403 无权选审'));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('monitor 展示兼容', () => {
  it('产生方式独立于审核状态，当前发布不能由通过推断', () => {
    expect(creationMethodLabel(version({ isWorkingCopy: true }))).toBe('历史副本');
    expect(creationMethodLabel(version({ scope: 'ENTERPRISE', sourceVersionId: 'source' }))).toBe('审核生成');
    expect(creationMethodLabel(version({ scope: 'PLATFORM' }))).toBe('运营创建');
    expect(creationMethodLabel(version({ scope: 'PLATFORM', sourceVersionId: 'source' }))).toBe('平台收录');
    expect(currentUsageLabel(version({ status: 'PLATFORM_APPROVED' }))).toBe('使用状态未标注');
    expect(currentUsageLabel(version({ scope: 'PLATFORM', isEnterpriseCurrent: true, isPlatformLatest: true, isMarketPublic: true }))).toBe('企业已启用 · 平台已发布');
    expect(currentUsageLabel(version({ scope: 'PLATFORM', status: 'PLATFORM_APPROVED', isPlatformLatest: false }))).toBe('历史版本');
    expect(creationMethodLabel(version({ generationType: 'REVIEW_SNAPSHOT' }))).toBe('审核快照');
  });
  it('变化后的历史工作副本可以选择新快照', () => {
    expect(canSelectSource(version({ isWorkingCopy: true, reviewSnapshots: [{ ...version(), workingCopyUpdatedAt: '2026-10-07T00:00:00.000Z', promotedVersions: [version()] }] }))).toBe(true);
    expect(monitorQuery({}, 20, 100)).toBe('page=20&limit=100');
  });
});
