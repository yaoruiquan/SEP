import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalChangesPanel } from './personal-changes-panel';
import type { PersonalDiffItem, SkillSubmissionDetail } from './use-capability-iteration';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), review: vi.fn(), refetch: vi.fn(), success: vi.fn(), pending: false }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: mocks.success, error: vi.fn() } }));
vi.mock('@/features/skill-version/use-skill-version', () => ({ useReviewEnterprisePersonalSkillVersion: () => ({ mutate: mocks.review, isPending: mocks.pending }) }));
vi.mock('./use-capability-iteration', () => ({ usePersonalDiffs: mocks.list, useSkillSubmissionDetail: mocks.detail, useSkillIdentity: () => 'enterprise:admin:ENTERPRISE_ADMIN' }));
function item(id = 'submission'): PersonalDiffItem {
  return { id, owner: { id: 'member', name: '普通成员', email: 'member@example.test' }, basedOn: { id: 'source', scope: 'PLATFORM', version: '1.0.0' },
    changeSummary: '\n完善需求分析\n完整说明', content: 'member change', updatedAt: '2026-10-09T00:00:00Z', adopted: false, adoptedAt: null,
    pending: true, status: 'PENDING_ENTERPRISE_REVIEW', reviewStatus: 'PENDING_ENTERPRISE_REVIEW', submittedAt: '2026-10-08T00:00:00Z',
    enterpriseReviewedAt: null, reviewedBy: null, rejectionReason: null, publishedVersionId: null, isWorkingCopy: false, canEdit: false, isLegacyUnpublished: false };
}
let detail: SkillSubmissionDetail;
beforeEach(() => {
  vi.clearAllMocks(); mocks.pending = false;
  const submission = item();
  detail = { canManage: true, item: { ...submission, version: '0.0.0-personal.very-long-hash' },
    source: { id: 'source', scope: 'PLATFORM', version: '1.0.0', content: 'original content' }, sourceState: 'AVAILABLE',
    currentBaseline: { id: 'current', scope: 'ENTERPRISE', version: '1.0.0', content: 'current content' }, currentBaselineState: 'EXPLICIT', reviews: [] };
  mocks.list.mockReturnValue({ data: { canManage: true, items: [submission], total: 1, page: 1, limit: 20 }, refetch: mocks.refetch });
  mocks.detail.mockImplementation(() => ({ data: detail, refetch: mocks.refetch, isFetching: false }));
  mocks.refetch.mockImplementation(async () => ({ data: detail, isError: false }));
});
function open() { render(<PersonalChangesPanel capabilityId="cap" currentUserId="admin" />); fireEvent.click(screen.getByRole('button', { name: '审核' })); }
function tab(name: string) { fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false }); }

describe('提交与审核', () => {
  it('主标题使用首个非空说明，不出现内部版本；管理员自己的提交与其他人同列', () => {
    mocks.list.mockReturnValue({ data: { canManage: true, items: [item(), { ...item('self'), owner: { id: 'admin', name: '管理员', email: '' } }], total: 2 } });
    render(<PersonalChangesPanel capabilityId="cap" currentUserId="admin" />);
    expect(screen.getAllByRole('heading', { name: '完善需求分析' })).toHaveLength(2);
    expect(screen.getByText('管理员')).toBeVisible(); expect(screen.getByText('普通成员')).toBeVisible();
    expect(screen.queryByText(/0\.0\.0-personal/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /创建|编辑|弃用|保存/ })).not.toBeInTheDocument();
  });
  it('成员列表仅显示本人，已通过记录只有查看入口', () => {
    mocks.list.mockReturnValue({ data: { canManage: false, items: [item(), { ...item('other'), owner: { id: 'admin', name: '其他人', email: '' } }], total: 1 } });
    render(<PersonalChangesPanel capabilityId="cap" currentUserId="member" />);
    expect(screen.queryByText('其他人')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: '查看详情' })).toBeVisible();
    detail.canManage = false;
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    expect(screen.queryByRole('button', { name: '通过并启用' })).not.toBeInTheDocument();
  });
  it('默认以固定来源比较，可切换当前版本，完整正文独立展示', () => {
    open();
    expect(screen.getByRole('region', { name: '正文差异' })).toHaveTextContent('original content');
    expect(screen.getByRole('region', { name: '正文差异' })).toHaveTextContent('member change');
    expect(screen.getByText(/不会自动合并差异/)).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: '对比对象' }), { target: { value: 'current' } });
    expect(screen.getByRole('region', { name: '正文差异' })).toHaveTextContent('current content');
    tab('完整内容'); expect(screen.getByRole('region', { name: '完整正文' })).toHaveTextContent('member change');
  });
  it('未记录来源不会将全部正文伪装成新增，仍可查看全文', () => {
    detail.source = null; detail.sourceState = 'NONE'; open();
    expect(screen.getByText('此提交未记录来源版本，无法展示历史差异')).toBeVisible();
    expect(screen.queryByRole('region', { name: '正文差异' })).not.toBeInTheDocument();
    tab('完整内容'); expect(screen.getByRole('region', { name: '完整正文' })).toHaveTextContent('member change');
  });
  it('确认通过后客户端提交不发送可变副本时间戳，并留在详情等待刷新结果', async () => {
    mocks.review.mockImplementation((_payload, options) => options.onSuccess()); open();
    fireEvent.click(screen.getByRole('button', { name: '通过并启用' })); expect(mocks.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认通过并启用' }));
    expect(mocks.review).toHaveBeenCalledWith({ id: 'submission', decision: 'APPROVE', comment: undefined }, expect.any(Object));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled()); expect(screen.getByRole('dialog')).toBeVisible();
    expect(mocks.success).toHaveBeenCalledWith('审核通过并启用');
  });
  it('历史工作副本发送预览修订时间，遗留通过未发布可走相同审核入口', () => {
    detail.item.isWorkingCopy = true; detail.item.isLegacyUnpublished = true; detail.item.pending = false; open();
    fireEvent.click(screen.getByRole('button', { name: '通过并启用' })); fireEvent.click(screen.getByRole('button', { name: '确认通过并启用' }));
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: detail.item.updatedAt }), expect.any(Object));
  });
  it('驳回原因必填，不允许仅空格', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    expect(screen.getByRole('button', { name: '确认驳回' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '驳回原因' }), { target: { value: '  请补充边界  ' } });
    fireEvent.click(screen.getByRole('button', { name: '确认驳回' }));
    expect(mocks.review).toHaveBeenCalledWith({ id: 'submission', decision: 'REJECT', comment: '请补充边界' }, expect.any(Object));
  });
  it('轮询发现变化必须重新预览，不能批准旧正文', () => {
    open(); const original = detail;
    detail = { ...original, item: { ...original.item, content: 'new content', updatedAt: '2026-10-10T00:00:00Z' } };
    fireEvent.click(screen.getByRole('tab', { name: '内容差异' }));
    // Force a local render so the refreshed query mock becomes visible.
    fireEvent.change(screen.getByRole('combobox', { name: '对比对象' }), { target: { value: 'current' } });
    expect(screen.getByRole('alert')).toHaveTextContent('请刷新并重新预览后审核');
    expect(screen.getByRole('button', { name: '通过并启用' })).toBeDisabled(); expect(mocks.review).not.toHaveBeenCalled();
  });
  it('409冲突刷新最新详情且不关闭，审批期间禁用重复提交', () => {
    mocks.review.mockImplementation((_payload, options) => options.onError(Object.assign(new Error('版本冲突'), { status: 409 })));
    open(); fireEvent.click(screen.getByRole('button', { name: '通过并启用' })); fireEvent.click(screen.getByRole('button', { name: '确认通过并启用' }));
    expect(mocks.refetch).toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeVisible();
  });
  it('处理记录展示真实审核人意见，发布版本为可定位链接而非ID', () => {
    detail.item.pending = false; detail.item.reviewStatus = 'ENTERPRISE_APPROVED';
    detail.item.publishedVersion = { id: 'released', scope: 'ENTERPRISE', version: '2.0.0', isCurrent: false };
    detail.reviews = [{ id: 'review', actorType: 'ENTERPRISE', decision: 'APPROVE', comment: '审核确认', reviewer: { id: 'reviewer', name: '审核管理员' }, createdAt: '2026-10-09T00:00:00Z' }];
    open(); tab('处理记录');
    expect(screen.getByText('审核管理员')).toBeVisible(); expect(screen.getByText('审核确认')).toBeVisible();
    expect(screen.getByRole('link', { name: '企业版 2.0.0' })).toHaveAttribute('href', '/capabilities/cap?tab=versions&release=released');
    expect(screen.queryByRole('button', { name: '通过并启用' })).not.toBeInTheDocument();
  });
  it('历史副本的每次审核显示真实快照修订和对应发布版', () => {
    detail.item.isWorkingCopy = true;
    detail.reviews = [{ id: 'review-snapshot', versionId: 'snapshot', version: '0.0.0-snapshot.1', actorType: 'ENTERPRISE', decision: 'APPROVE',
      comment: '确认修订', reviewer: { id: 'admin', name: '管理员' }, createdAt: '2026-10-09T00:00:00Z',
      publishedVersion: { id: 'old-release', scope: 'ENTERPRISE', version: '1.0.1' } }];
    open(); tab('处理记录');
    expect(screen.getByText('0.0.0-snapshot.1')).toBeVisible();
    expect(screen.getByRole('link', { name: '企业版 1.0.1' })).toHaveAttribute('href', '/capabilities/cap?tab=versions&release=old-release');
  });
  it('分页及状态深链接交由服务端查询，切换状态重置页码', () => {
    const navigate = vi.fn(); mocks.list.mockReturnValue({ data: { canManage: true, items: [], total: 41, page: 2, limit: 20 } });
    render(<PersonalChangesPanel capabilityId="cap" currentUserId="admin" initialPage={2} initialStatus="pending" onNavigate={navigate} />);
    expect(mocks.list).toHaveBeenLastCalledWith('cap', true, 2, 'PENDING_ENTERPRISE_REVIEW');
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); expect(navigate).toHaveBeenLastCalledWith({ status: 'pending', page: '3' });
    fireEvent.change(screen.getByRole('combobox', { name: '审核状态' }), { target: { value: 'approved' } });
    expect(navigate).toHaveBeenLastCalledWith({ status: 'approved', page: null });
  });
  it('直接打开其他页提交需要单独授权查询，错误不会展示旧正文', () => {
    mocks.detail.mockReturnValue({ isError: true, error: new Error('无权访问'), refetch: mocks.refetch });
    render(<PersonalChangesPanel capabilityId="cap" currentUserId="member" submissionId="private" onNavigate={vi.fn()} />);
    expect(mocks.detail).toHaveBeenCalledWith('cap', 'private'); expect(screen.getByRole('alert')).toHaveTextContent('无权访问');
    expect(within(screen.getByRole('dialog')).queryByText('member change')).not.toBeInTheDocument();
  });
});
