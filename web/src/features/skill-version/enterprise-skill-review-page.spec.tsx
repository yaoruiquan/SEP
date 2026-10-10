import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { toast } from '@/components/ui/toast';
import type { EnterpriseReviewItem } from './use-skill-version';
import EnterpriseSkillReviewPage from './enterprise-skill-review-page';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api-client')>(),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/chat/markdown', () => ({ Markdown: ({ content }: { content: string }) => <p>{content}</p> }));

const versionId = 'psv_0533f3eb6fe840bcfc6df73d605fb315fc68d0e1cad82332d8218e141ba2257e';
const item: EnterpriseReviewItem = {
  id: versionId, capabilityId: 'cmszr2p7e009g7qr52xbo0o1x', parentVersionId: 'platform-v1',
  enterpriseId: 'demo-ent-shuyi', ownerId: 'submitter', scope: 'PERSONAL', version: '0.0.0-personal.digest',
  status: 'PENDING_ENTERPRISE_REVIEW', changeSummary: '调整输入说明',
  submittedAt: '2026-10-08T08:48:26.730Z', enterpriseReviewedAt: null, rejectionReason: null,
  createdAt: '2026-10-08T08:48:26.732Z', updatedAt: '2026-10-08T08:48:26.732Z',
  capability: { id: 'cmszr2p7e009g7qr52xbo0o1x', name: '客户记录整理', description: '整理输入' },
  owner: { id: 'submitter', name: '提交员工', email: 'member@example.test' },
};
let clients: QueryClient[] = [];
let total: number;
let rows: EnterpriseReviewItem[];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const rendered = render(<QueryClientProvider client={client}><EnterpriseSkillReviewPage /></QueryClientProvider>);
  return { client, invalidate, ...rendered };
}
function queueCalls() {
  return vi.mocked(api.get).mock.calls.map(([path]) => path).filter((path) => path.startsWith('/enterprise/skill-version-reviews?'));
}
async function waitForQueue() {
  await screen.findByText('客户记录整理');
}

beforeEach(() => {
  vi.clearAllMocks();
  total = 1;
  rows = [{ ...item }];
  useAuthStore.setState({ enterprise: { id: 'demo-ent-shuyi', name: '测试企业' }, roleInEnterprise: 'ENTERPRISE_ADMIN' });
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path.includes('/preview')) return { ...item, content: '# 完整技能正文', sourceVersionId: null } as never;
    const params = new URLSearchParams(path.split('?')[1]);
    return {
      total, page: Number(params.get('page')), limit: Number(params.get('limit')),
      items: rows.map((row) => ({ ...row, status: params.get('status') })),
    } as never;
  });
  vi.mocked(api.post).mockResolvedValue({ ...item, status: 'ENTERPRISE_APPROVED' });
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients = [];
  useAuthStore.setState({ enterprise: null, roleInEnterprise: null, user: null });
});

describe('企业个人 Skill 审核闭环页面', () => {
  it.each([
    [false, '客户端提交'], [true, '历史 Web 副本'], [undefined, '个人提交'],
  ] as const)('来源字段%s可靠标记为%s，审核始终只有单一原始版本', async (isWorkingCopy, label) => {
    rows = [{ ...item, isWorkingCopy }];
    setup();
    await waitForQueue();
    expect(screen.getByText(`来源：${label}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '通过并启用' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith(
      `/enterprise/skill-versions/${versionId}/review`,
      { decision: 'APPROVE', ...(isWorkingCopy ? { expectedUpdatedAt: item.updatedAt } : {}) },
    ));
  });
  it('默认查询企业个人待审队列，显示客户端回执ID、提交人、变更与状态', async () => {
    setup();
    await waitForQueue();
    expect(queueCalls()).toEqual(['/enterprise/skill-version-reviews?status=PENDING_ENTERPRISE_REVIEW&page=1&limit=20']);
    expect(screen.getByText(`版本 ID：${versionId}`)).toBeInTheDocument();
    expect(screen.getByText('提交员工')).toBeInTheDocument();
    expect(screen.getByText('变更说明：调整输入说明')).toBeInTheDocument();
    expect(screen.getByText('待企业审核')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.every(([path]) => !path.includes('/admin/') && !path.includes('/audit-logs'))).toBe(true);
  });

  it.each(['MEMBER', 'DEPT_MANAGER', null])('非企业管理员 %s 不发队列请求，即便全局是ADMIN', async (role) => {
    useAuthStore.setState({ roleInEnterprise: role, user: { id: 'platform-admin', name: null, email: 'admin@example.test', avatar: null, role: 'ADMIN' } });
    setup();
    expect(screen.getByText('仅企业管理员可审核')).toBeInTheDocument();
    await act(async () => {});
    expect(api.get).not.toHaveBeenCalled();
  });

  it('缺少企业身份不发请求', async () => {
    useAuthStore.setState({ enterprise: null });
    setup();
    expect(screen.getByText('仅企业管理员可审核')).toBeInTheDocument();
    await act(async () => {});
    expect(api.get).not.toHaveBeenCalled();
  });

  it('分页与切换审核状态，切换后回到第1页且已审记录只读', async () => {
    total = 41;
    setup();
    await waitForQueue();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(queueCalls().at(-1)).toContain('page=2'));
    fireEvent.click(screen.getByRole('button', { name: '已通过' }));
    await waitFor(() => expect(queueCalls().at(-1)).toBe('/enterprise/skill-version-reviews?status=ENTERPRISE_APPROVED&page=1&limit=20'));
    await screen.findByText('企业已通过');
    expect(screen.queryByRole('button', { name: '通过并启用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '驳回' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看内容' })).toBeInTheDocument();
  });

  it('技能ID精确筛选、清除及手动刷新', async () => {
    setup();
    await waitForQueue();
    fireEvent.change(screen.getByRole('textbox', { name: '技能 ID' }), { target: { value: ` ${item.capabilityId} ` } });
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    await waitFor(() => expect(queueCalls().at(-1)).toContain(`capabilityId=${item.capabilityId}`));
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    await waitFor(() => expect(queueCalls().at(-1)).not.toContain('capabilityId='));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());
    const count = queueCalls().length;
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(queueCalls().length).toBeGreaterThan(count));
  });

  it('预览使用企业授权路径并准确标注个人版本', async () => {
    setup();
    await waitForQueue();
    fireEvent.click(screen.getByRole('button', { name: '查看内容' }));
    await screen.findByText('# 完整技能正文');
    expect(api.get).toHaveBeenCalledWith(`/enterprise/skill-versions/${versionId}/preview`);
    expect(within(screen.getByRole('dialog')).getByText('版本 0.0.0-personal.digest · 个人版本')).toBeInTheDocument();
  });

  it('通过使用同一版本ID和企业审核接口，刷新版本及时间线，不触发选版', async () => {
    const { invalidate } = setup();
    await waitForQueue();
    fireEvent.click(screen.getByRole('button', { name: '通过并启用' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith(`/enterprise/skill-versions/${versionId}/review`, { decision: 'APPROVE', comment: undefined }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('审核通过并启用', expect.any(String)));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['skill-versions'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['capability-iteration'] });
    expect(queueCalls().length).toBeGreaterThan(1);
    expect(vi.mocked(api.post).mock.calls.every(([path]) => !path.includes('select-'))).toBe(true);
  });

  it('驳回先校验空白原因不提交，填写后提交trim后的原因并关闭弹窗', async () => {
    setup();
    await waitForQueue();
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    fireEvent.change(screen.getByRole('textbox', { name: '驳回原因' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '确认驳回' }));
    expect(screen.getByRole('alert')).toHaveTextContent('驳回时必须填写原因');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '驳回原因' }), { target: { value: ' 请补充异常处理说明 ' } });
    fireEvent.click(screen.getByRole('button', { name: '确认驳回' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith(`/enterprise/skill-versions/${versionId}/review`, { decision: 'REJECT', comment: '请补充异常处理说明' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith('已驳回个人版本', undefined);
  });

  it('审核进行中禁止重复通过/驳回操作', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((done) => { resolve = done; }) as never);
    setup();
    await waitForQueue();
    fireEvent.click(screen.getByRole('button', { name: '通过并启用' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '通过并启用' })).toBeDisabled());
    expect(screen.getByRole('button', { name: '驳回' })).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => resolve(item));
  });

  it('队列403显示正确企业权限错误，不回退平台队列', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, 'Forbidden'));
    setup();
    await screen.findByText('仅企业管理员可审核');
    expect(screen.getByText('请确认当前企业身份；平台管理员不能代替企业管理员。')).toBeInTheDocument();
    expect(queueCalls()).toHaveLength(1);
  });

  it('审核409提示已被处理并刷新，不再次发送审核', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, '已审核'));
    setup();
    await waitForQueue();
    fireEvent.click(screen.getByRole('button', { name: '通过并启用' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('该版本已审核', expect.any(String)));
    await waitFor(() => expect(queueCalls().length).toBeGreaterThan(1));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('驳回请求失败保留输入和弹窗，允许人工重试', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(500, '服务暂不可用'));
    setup();
    await waitForQueue();
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    fireEvent.change(screen.getByRole('textbox', { name: '驳回原因' }), { target: { value: '需要补充说明' } });
    fireEvent.click(screen.getByRole('button', { name: '确认驳回' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('服务暂不可用'));
    expect(screen.getByRole('textbox', { name: '驳回原因' })).toHaveValue('需要补充说明');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('已驳回展示审核时间和原因，旧后端无关联字段回退ID', async () => {
    rows = [{ ...item, capability: undefined, owner: undefined, rejectionReason: '补充格式说明', enterpriseReviewedAt: '2026-10-08T09:00:00Z' }];
    setup();
    await screen.findByRole('heading', { name: item.capabilityId });
    fireEvent.click(screen.getByRole('button', { name: '已驳回' }));
    await screen.findByText('企业已驳回');
    expect(screen.getByText('驳回原因：补充格式说明')).toBeInTheDocument();
    expect(screen.getByText('审核时间')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过并启用' })).not.toBeInTheDocument();
  });

  it('空队列不伪造记录，显示个人提交和历史副本空态', async () => {
    rows = [];
    total = 0;
    setup();
    await screen.findByText('暂无符合条件的审核记录');
    expect(screen.getByText('暂无符合筛选条件的个人提交或历史 Web 副本。')).toBeInTheDocument();
  });
});
