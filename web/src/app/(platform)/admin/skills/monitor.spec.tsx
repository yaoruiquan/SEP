import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminSkillsPage from './page';
import DetailPage from './[versionId]/page';
import { canSelectSource, creationMethodLabel, currentUsageLabel, monitorQuery, originalSubmitterLabel, type MonitorDetail } from './monitor';

const { get, post, push, toastError, toastSuccess } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), push: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: { get, post } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ versionId: 'source-1' }), useRouter: () => ({ push }) }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));
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
    for (const label of ['版本类型', '企业审核', '平台收录状态']) expect(screen.getByLabelText(label)).toHaveValue('');
    const typeFilter = screen.getByLabelText('版本类型');
    expect(Array.from(typeFilter.querySelectorAll('option'), (option) => option.textContent)).toEqual(['全部', '个人提交', '企业发布版', '平台版本']);
    expect(screen.queryByLabelText('来源')).not.toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('版本类型'), { target: { value: 'ENTERPRISE' } });
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
  it('企业发布版分别显示成员原提交人和管理员审核发布人，并链接对应版本', async () => {
    get.mockResolvedValue({ items: [version({
      scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED', ownerId: null, owner: null,
      enterpriseReviewStatus: 'APPROVED', createdBy: { id: 'admin-1', name: '审核管理员' },
      originalSubmitters: [{ id: 'member-1', name: '原修改成员' }, { id: 'member-2', name: '另一成员' }],
      enterprisePublisher: { id: 'admin-1', name: '审核管理员' },
      enterprisePublishedVersions: [{ id: 'enterprise-1', version: '1.0.2', isEnterpriseCurrent: true }],
    })], total: 1, page: 1, limit: 20 });
    mount(<AdminSkillsPage />);
    const row = await screen.findByRole('row', { name: /来源技能/ });
    expect(within(row).getByText('原修改成员、另一成员')).toBeInTheDocument();
    expect(within(row).getByText('审核管理员')).toBeInTheDocument();
    expect(within(row).getByText('原提交人')).toBeInTheDocument();
    expect(within(row).getByText('审核发布人')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: '企业发布版 v1.0.2' })).toHaveAttribute('href', '/admin/skills/enterprise-1');
    expect(within(row).getByText('企业已启用')).toBeInTheDocument();
    expect(within(row).getByText('技能 ID：private-cap')).toBeInTheDocument();
    expect(within(row).getByText('版本 ID：source-1')).toBeInTheDocument();
  });
  it('已通过个人提交显示独立的企业发布版，历史缺关联不推断已发布', async () => {
    get.mockResolvedValue({ items: [version({
      enterpriseReviewStatus: 'APPROVED', status: 'ENTERPRISE_APPROVED',
      originalSubmitters: [{ id: 'member-1', name: '原修改成员' }],
      enterprisePublisher: { id: 'admin-1', name: '审核管理员' }, enterprisePublishedVersions: [],
    })], total: 1, page: 1, limit: 20 });
    mount(<AdminSkillsPage />);
    const row = await screen.findByRole('row', { name: /来源技能/ });
    expect(within(row).getByText('个人提交')).toBeInTheDocument();
    expect(within(row).getByText('企业通过')).toBeInTheDocument();
    expect(within(row).getByText('未关联企业发布版')).toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: /企业发布版 v/ })).not.toBeInTheDocument();
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
  it('平台详情追溯原提交人和对应企业发布版，不把平台创建人当作提交人', async () => {
    get.mockResolvedValue(version({
      scope: 'PLATFORM', status: 'PLATFORM_APPROVED', sourceVersionId: 'enterprise-1',
      createdBy: { id: 'platform-admin', name: '平台运营人员' },
      originalSubmitters: [{ id: 'member-1', name: '原修改成员' }],
      enterprisePublisher: { id: 'enterprise-admin', name: '企业审核管理员' },
      enterprisePublishedVersions: [
        { id: 'enterprise-1', version: '1.0.2', isEnterpriseCurrent: false },
        { id: 'enterprise-2', version: '1.0.3', isEnterpriseCurrent: true },
      ],
    }));
    mount(<DetailPage />);
    const attribution = await screen.findByRole('region', { name: '版本归属' });
    expect(within(attribution).getByText('原修改成员')).toBeInTheDocument();
    expect(within(attribution).getByText('企业审核管理员')).toBeInTheDocument();
    expect(within(attribution).queryByText('平台运营人员')).not.toBeInTheDocument();
    expect(within(attribution).getByRole('link', { name: '企业发布版 v1.0.2' })).toHaveAttribute('href', '/admin/skills/enterprise-1');
    expect(within(attribution).getByRole('link', { name: '企业发布版 v1.0.3' })).toHaveAttribute('href', '/admin/skills/enterprise-2');
    expect(within(attribution).getByText('历史版本')).toBeInTheDocument();
    expect(within(attribution).getByText('企业已启用')).toBeInTheDocument();
  });
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
    expect(screen.getByRole('link', { name: /个人提交 v/ })).toHaveAttribute('href', '/admin/skills/source-1');
    expect(screen.getByText('原始包.zip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    expect(post).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('驳回时必须填写原因');
    expect(screen.getByRole('alert')).toHaveTextContent('驳回时必须填写原因');
    fireEvent.change(screen.getByPlaceholderText('驳回时必须填写原因'), { target: { value: '  包需要补充说明  ' } });
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    expect(screen.getByRole('alert')).toHaveTextContent('403 无权选审');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('monitor 详情校验与操作错误', () => {
  const actions = [
    { name: '收录', button: '收录到平台待审', path: 'adopt', overrides: {} },
    { name: '送审', button: '提交平台审核', path: 'submit-review', overrides: { scope: 'PLATFORM', status: 'DRAFT' } },
    { name: '审核', button: '审核通过并发布', path: 'review', overrides: { scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW' } },
  ] satisfies { name: string; button: string; path: string; overrides: Partial<MonitorDetail> }[];

  it.each(actions)('$name：warning 只展示 message，不阻断现有操作', async ({ button, path, overrides }) => {
    const message = '建议补充“角色”标题 <script>alert("warning")</script>';
    get.mockResolvedValue(version({
      ...overrides,
      validationResult: {
        valid: true,
        issues: [],
        checks: [{ code: 'SECTION_ROLE', passed: false, message: '不能直接展示的检查对象' }],
        warnings: [
          { code: 'SECTION_ROLE', message, path: 'private/path', raw: 'private-value' },
          null, '不能展示的原始字符串', { message: { secret: '不能展示的原始对象' } }, { message: '   ' },
        ],
        raw: '不能展示的原始结果',
      },
    }));
    post.mockResolvedValue(version({ id: 'platform-1' }));
    mount(<DetailPage />);
    const validation = await screen.findByRole('region', { name: '已存校验结果' });
    expect(within(validation).getByText('已存静态校验通过')).toBeInTheDocument();
    const warnings = within(validation).getByRole('list', { name: '校验提醒' });
    expect(within(warnings).getAllByRole('listitem')).toHaveLength(1);
    expect(warnings).toHaveTextContent(message);
    expect(validation.querySelector('script')).toBeNull();
    expect(validation).not.toHaveTextContent(/private\/path|private-value|SECTION_ROLE|不能展示|不能直接展示|\[object Object\]/);
    expect(screen.getByRole('button', { name: button })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/admin/skill-versions/source-1/${path}`, expect.any(Object)));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(actions)('$name：具体失败持续显示，刷新不清除，重试及成功清理', async ({ button, path, overrides }) => {
    const detail = version(overrides);
    const message = '校验失败：Skill 正文至少需要 20 个字符；正文不能包含敏感凭据；能力包未通过安全扫描';
    get.mockResolvedValue(detail);
    let resolveRetry!: (value: MonitorDetail) => void;
    post.mockRejectedValueOnce(new Error(message)).mockImplementationOnce(() => new Promise<MonitorDetail>((resolve) => { resolveRetry = resolve; }));
    const client = mount(<DetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: button }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(toastError).toHaveBeenCalledWith(message);
    expect(push).not.toHaveBeenCalled();
    await act(async () => { await client.invalidateQueries({ queryKey: ['skill-versions'] }); });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('region', { name: '只读正文' })).toHaveTextContent(detail.content);
    await waitFor(() => expect(screen.getByRole('button', { name: button })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await act(async () => { resolveRetry(version({ id: 'platform-1' })); });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(post).toHaveBeenLastCalledWith(`/admin/skill-versions/source-1/${path}`, expect.any(Object));
    if (path === 'adopt') expect(push).toHaveBeenCalledWith('/admin/skills/platform-1');
    else if (path === 'review') expect(push).toHaveBeenCalledWith('/admin/skills');
    else expect(push).not.toHaveBeenCalled();
  });

  it.each([
    { validationResult: { valid: false, issues: [{ code: 'SECTION_ROLE', message: '历史校验缺少角色标题' }], warnings: [{ message: '建议补充示例' }] } },
    { validationResult: { valid: false, checks: [{ code: 'SECTION_ROLE', passed: false, message: '历史校验缺少角色标题' }] } },
    { validationResult: { checks: [{ code: 'SECTION_ROLE', passed: false, message: '历史校验缺少角色标题' }] } },
  ])('保留历史失败标题，不按新 warning 规则改判通过 %#', async (overrides) => {
    get.mockResolvedValue(version(overrides));
    mount(<DetailPage />);
    const validation = await screen.findByRole('region', { name: '已存校验结果' });
    expect(within(validation).getByText('已存静态校验未通过')).toBeInTheDocument();
    expect(within(validation).getByRole('list', { name: '校验问题' })).toHaveTextContent('历史校验缺少角色标题');
    expect(validation).not.toHaveTextContent('已存静态校验通过');
    expect(validation).not.toHaveTextContent('安全通过');
    expect(screen.getByRole('button', { name: '收录到平台待审' })).toBeEnabled();
  });

  it.each([
    { validationResult: undefined, label: '无已存校验结果' },
    { validationResult: null, label: '无已存校验结果' },
    { validationResult: {}, label: '已存校验状态未标注' },
    { validationResult: '旧格式记录', label: '已存校验状态未标注' },
    { validationResult: [], label: '已存校验状态未标注' },
    { validationResult: { warnings: { message: '非数组' }, issues: '旧字段', checks: null }, label: '已存校验状态未标注' },
    { validationResult: { valid: false, issues: [null, { message: { raw: '不能展示' } }], warnings: [42] }, label: '已存静态校验未通过' },
  ])('旧/无校验字段兼容且不误报通过 %#', async ({ validationResult, label }) => {
    get.mockResolvedValue(version({ validationResult }));
    mount(<DetailPage />);
    const validation = await screen.findByRole('region', { name: '已存校验结果' });
    expect(within(validation).getByText(label)).toBeInTheDocument();
    expect(within(validation).queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收录到平台待审' })).toBeEnabled();
  });
});

describe('monitor 展示兼容', () => {
  it('历史企业版缺来源不冒用管理员，规范化空来源也不使用创建人兜底', () => {
    const admin = { id: 'admin-1', name: '审核管理员' };
    expect(originalSubmitterLabel(version({ scope: 'ENTERPRISE', createdBy: admin }))).toBe('未标注');
    expect(originalSubmitterLabel(version({ createdBy: admin, originalSubmitters: [] }))).toBe('未标注');
    expect(originalSubmitterLabel(version({ createdBy: admin }))).toBe('审核管理员');
    expect(originalSubmitterLabel(version({ originalSubmitters: [{ id: 'deleted-name', name: null }] }))).toBe('deleted-name');
  });
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
