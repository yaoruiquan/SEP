import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalChangesPanel } from './personal-changes-panel';

const { usePersonalDiffs, useVersionTimeline, updatePersonal, createPersonal, success, review, refetch } = vi.hoisted(() => ({ usePersonalDiffs: vi.fn(), useVersionTimeline: vi.fn(), updatePersonal: vi.fn(), createPersonal: vi.fn(), success: vi.fn(), review: vi.fn(), refetch: vi.fn() }));

vi.mock('@/components/ui/toast', () => ({ toast: { success, error: vi.fn() } }));
vi.mock('@/features/skill-version/use-skill-version', () => ({
  useReviewEnterprisePersonalSkillVersion: () => ({ isPending: false, mutate: review }),
}));

vi.mock('./use-capability-iteration', () => ({
  usePersonalDiffs,
  useVersionTimeline,
  useCreatePersonalVersion: () => ({ isPending: false, mutate: createPersonal }),
  useDiscardPersonalVersion: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdatePersonalVersion: () => ({ isPending: false, mutate: updatePersonal }),
}));

function reviewFields(isWorkingCopy = true) {
  return {
    status: isWorkingCopy ? 'PERSONAL_ACTIVE' : 'PENDING_ENTERPRISE_REVIEW',
    reviewStatus: 'PENDING_ENTERPRISE_REVIEW', submittedAt: isWorkingCopy ? null : '2026-10-08T08:48:26.730Z',
    enterpriseReviewedAt: null, reviewedBy: null, rejectionReason: null, publishedVersionId: null,
    isWorkingCopy, canEdit: isWorkingCopy, isLegacyUnpublished: false,
  };
}

describe('PersonalChangesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVersionTimeline.mockReturnValue({ data: { subscriptions: [{ canSelectPersonal: true }] }, isError: false });
    usePersonalDiffs.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch,
      data: {
        canManage: true,
        baseline: { id: 'base', scope: 'ENTERPRISE', version: '1.0.0', content: 'base' },
        items: [
          {
            id: 'admin-copy',
            owner: { id: 'admin', name: '企业管理员', email: 'admin@example.com' },
            basedOn: null,
            changeSummary: '管理员自己的改动',
            content: 'admin change',
            updatedAt: '2026-09-08T00:00:00.000Z',
            adopted: false,
            adoptedAt: null,
            pending: true,
            ...reviewFields(),
          },
          {
            id: 'member-copy',
            owner: { id: 'member', name: '普通成员', email: 'member@example.com' },
            basedOn: null,
            changeSummary: '成员改动',
            content: 'member change',
            updatedAt: '2026-09-08T00:00:00.000Z',
            adopted: false,
            adoptedAt: null,
            pending: true,
            ...reviewFields(),
          },
        ],
      },
    });
  });

  it('企业管理员的副本也显示在大家的改动中', () => {
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);

    expect(screen.getByText('企业管理员')).toBeInTheDocument();
    expect(screen.getByText('普通成员')).toBeInTheDocument();
  });

  it('普通成员不把自己的副本重复显示在大家的改动中', () => {
    usePersonalDiffs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        canManage: false,
        baseline: null,
        items: [
          {
            id: 'member-copy',
            owner: { id: 'member', name: '普通成员', email: 'member@example.com' },
            basedOn: null,
            changeSummary: null,
            content: 'member change',
            updatedAt: '2026-09-08T00:00:00.000Z',
            adopted: false,
            adoptedAt: null,
            pending: true,
            ...reviewFields(),
          },
        ],
      },
    });

    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="member" />);

    expect(screen.queryByText('普通成员')).not.toBeInTheDocument();
    expect(screen.getByText('我的副本')).toBeInTheDocument();
  });

  it('副本已保存不代表已使用，不显示解释性使用提示', () => {
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.getByText('已保存')).toBeInTheDocument();
    expect(screen.queryByText('已生效')).not.toBeInTheDocument();
    expect(screen.queryByText(/使用该副本时，保存后下一次执行采用新内容/)).not.toBeInTheDocument();
    expect(screen.queryByText(/保存不会覆盖已选的平台版/)).not.toBeInTheDocument();
  });

  it('保存只编辑正文，成功提示不声称所有订阅立即切到副本', () => {
    updatePersonal.mockImplementation((_payload, options) => options.onSuccess());
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '更新正文' } });
    fireEvent.click(screen.getByRole('button', { name: '保存副本' }));
    expect(updatePersonal).toHaveBeenCalledWith({ versionId: 'admin-copy', content: '更新正文', changeSummary: '管理员自己的改动' }, expect.any(Object));
    expect(success).toHaveBeenCalledWith('已保存');
    expect(screen.queryByRole('button', { name: '保存并生效' })).not.toBeInTheDocument();
  });

  it('创建成功只报告保存结果，不显示使用提示', () => {
    usePersonalDiffs.mockReturnValue({ isLoading: false, isError: false, data: { canManage: false, baseline: null, items: [] } });
    createPersonal.mockImplementation((_payload, options) => options.onSuccess());
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="member" />);
    expect(screen.queryByText(/新建副本会在本次授权订阅使用/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建我的副本' }));
    expect(success).toHaveBeenCalledWith('我的副本已保存');
  });

  it('工作副本必须先预览正文与差异，再确认审核并传预览时间戳', () => {
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.queryByRole('button', { name: '一键审核' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '审核通过' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '预览并审核' })[1]);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('region', { name: '完整正文' })).toHaveTextContent('member change');
    expect(dialog.getByRole('region', { name: '正文差异' })).toHaveTextContent('member change');
    fireEvent.click(dialog.getByRole('button', { name: '审核通过' }));
    expect(review).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: '确认通过并发布' }));
    expect(review).toHaveBeenCalledWith({ id: 'member-copy', decision: 'APPROVE', comment: undefined, expectedUpdatedAt: '2026-09-08T00:00:00.000Z' }, expect.any(Object));
  });

  it('客户端提交审核不发工作副本时间戳，驳回必须填写原因', () => {
    const query = usePersonalDiffs();
    Object.assign(query.data.items[1], reviewFields(false));
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.getByText('客户端提交')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '预览并审核' })[1]);
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: '驳回' }));
    expect(dialog.getByRole('button', { name: '确认驳回' })).toBeDisabled();
    fireEvent.change(dialog.getByRole('textbox', { name: '驳回原因' }), { target: { value: '   ' } });
    expect(dialog.getByRole('button', { name: '确认驳回' })).toBeDisabled();
    fireEvent.change(dialog.getByRole('textbox', { name: '驳回原因' }), { target: { value: ' 请补充描述 ' } });
    fireEvent.click(dialog.getByRole('button', { name: '确认驳回' }));
    expect(review).toHaveBeenCalledWith({ id: 'member-copy', decision: 'REJECT', comment: '请补充描述' }, expect.any(Object));
  });

  it('轮询发现工作副本变化时不悄悄替换预览，禁止旧预览发布', () => {
    const { rerender } = render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    fireEvent.click(screen.getAllByRole('button', { name: '预览并审核' })[1]);
    fireEvent.click(screen.getByRole('button', { name: '审核通过' }));
    const query = usePersonalDiffs();
    query.data.items[1] = { ...query.data.items[1], updatedAt: '2026-10-09T00:00:00Z', content: '更新后的正文' };
    rerender(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('region', { name: '完整正文' })).toHaveTextContent('member change');
    expect(dialog.getByRole('alert')).toHaveTextContent('重新预览');
    expect(dialog.getByRole('button', { name: '确认通过并发布' })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: '确认通过并发布' }));
    expect(review).not.toHaveBeenCalled();
  });

  it('筛选历史通过未发布，可显式补发布但不能再次驳回', () => {
    const query = usePersonalDiffs();
    Object.assign(query.data.items[1], reviewFields(false), {
      reviewStatus: 'ENTERPRISE_APPROVED', status: 'ENTERPRISE_APPROVED', pending: false, isLegacyUnpublished: true,
    });
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    query.data.items = [query.data.items[1]];
    fireEvent.change(screen.getByRole('combobox', { name: '审核状态' }), { target: { value: 'ENTERPRISE_APPROVED' } });
    expect(usePersonalDiffs).toHaveBeenLastCalledWith('cap-1', true, 1, 'ENTERPRISE_APPROVED');
    expect(screen.queryByText('企业管理员')).not.toBeInTheDocument();
    expect(screen.getByText('历史通过未发布', { selector: 'span' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览并审核' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('button', { name: '驳回' })).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: '发布为企业版' }));
    fireEvent.click(dialog.getByRole('button', { name: '确认通过并发布' }));
    expect(review).toHaveBeenCalledWith({ id: 'member-copy', decision: 'APPROVE', comment: undefined }, expect.any(Object));
  });

  it('普通成员可查看本人客户端记录与驳回原因，但不能审核且不把快照当可编辑副本', () => {
    const query = usePersonalDiffs();
    query.data.canManage = false;
    query.data.items = [{ ...query.data.items[1], ...reviewFields(false), reviewStatus: 'ENTERPRISE_REJECTED', rejectionReason: '描述不完整', pending: false }];
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="member" />);
    expect(screen.getByText('驳回原因：描述不完整')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建我的副本' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览正文' }));
    expect(screen.queryByRole('button', { name: '审核通过' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '驳回' })).not.toBeInTheDocument();
  });

  it('服务端返回并发冲突时关闭旧预览并刷新列表', () => {
    review.mockImplementation((_payload, options) => options.onError(Object.assign(new Error('内容已变化，请重新预览'), { status: 409 })));
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    fireEvent.click(screen.getAllByRole('button', { name: '预览并审核' })[1]);
    fireEvent.click(screen.getByRole('button', { name: '审核通过' }));
    fireEvent.click(screen.getByRole('button', { name: '确认通过并发布' }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('翻页使用后端总数与独立工作副本，改动不在当前页仍可编辑', () => {
    const query = usePersonalDiffs();
    const workingCopy = query.data.items[0];
    query.data = { ...query.data, myWorkingCopy: workingCopy, items: [query.data.items[1]], total: 41, page: 1, limit: 20 };
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.getByText('共 41 条 · 第 1 / 3 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(usePersonalDiffs).toHaveBeenLastCalledWith('cap-1', true, 2, undefined);
    fireEvent.change(screen.getByRole('combobox', { name: '审核状态' }), { target: { value: 'ENTERPRISE_REJECTED' } });
    expect(usePersonalDiffs).toHaveBeenLastCalledWith('cap-1', true, 1, 'ENTERPRISE_REJECTED');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('admin change');
  });

  it('独立myWorkingCopy明确为空时不从分页记录推断工作副本', () => {
    const query = usePersonalDiffs();
    query.data.myWorkingCopy = null;
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.getByRole('button', { name: '创建我的副本' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  it('成员筛选结果为空时保留筛选入口以便返回全部', () => {
    const query = usePersonalDiffs();
    query.data.canManage = false;
    query.data.items = [query.data.items[1]];
    const { rerender } = render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="member" />);
    fireEvent.change(screen.getByRole('combobox', { name: '审核状态' }), { target: { value: 'ENTERPRISE_REJECTED' } });
    query.data = { ...query.data, items: [], total: 0, myWorkingCopy: null };
    rerender(<PersonalChangesPanel capabilityId="cap-1" currentUserId="member" />);
    expect(screen.getByText('暂无符合条件的改动')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '审核状态' }), { target: { value: 'ALL' } });
    expect(usePersonalDiffs).toHaveBeenLastCalledWith('cap-1', true, 1, undefined);
  });

  it.each([{ subscriptions: [] }, { subscriptions: [{ canSelectPersonal: false }] }])('无有效授权$subscriptions时管理员不能创建或编辑，但仍可审核', ({ subscriptions }) => {
    useVersionTimeline.mockReturnValue({ data: { subscriptions }, isError: false });
    const query = usePersonalDiffs();
    const { rerender } = render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '弃用' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.queryByRole('button', { name: '保存副本' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '预览并审核' })[1]);
    fireEvent.click(screen.getByRole('button', { name: '审核通过' }));
    fireEvent.click(screen.getByRole('button', { name: '确认通过并发布' }));
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ id: 'member-copy', decision: 'APPROVE' }), expect.any(Object));
    query.data.myWorkingCopy = null;
    rerender(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.getByRole('button', { name: '创建我的副本' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '创建我的副本' }));
    expect(createPersonal).not.toHaveBeenCalled();
    expect(updatePersonal).not.toHaveBeenCalled();
  });

  it('编辑期间授权撤销立即回到只读正文，不能继续保存', () => {
    const { rerender } = render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('button', { name: '保存副本' })).toBeEnabled();
    useVersionTimeline.mockReturnValue({ data: { subscriptions: [{ canSelectPersonal: false }] }, isError: false });
    rerender(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.queryByRole('button', { name: '保存副本' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled();
    expect(updatePersonal).not.toHaveBeenCalled();
  });

  it('有使用授权也不能编辑canEdit=false的工作副本', () => {
    const query = usePersonalDiffs();
    query.data.items[0].canEdit = false;
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.getByText('只读')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '弃用' })).not.toBeInTheDocument();
  });

  it.each(['ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'])('客户端%s记录及正文预览展示审核人与审核时间', (reviewStatus) => {
    const query = usePersonalDiffs();
    const reviewedAt = '2026-10-09T08:48:26.730Z';
    query.data.items = [{
      ...query.data.items[1], ...reviewFields(false), reviewStatus,
      pending: false, reviewedBy: { id: 'reviewer-1', name: '审核管理员' },
      enterpriseReviewedAt: reviewedAt,
      rejectionReason: reviewStatus === 'ENTERPRISE_REJECTED' ? '请补充内容' : null,
    }];

    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);

    expect(screen.getByText('审核人：审核管理员')).toBeInTheDocument();
    expect(screen.getByText(`审核时间：${new Date(reviewedAt).toLocaleString('zh-CN')}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览正文' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('审核人：审核管理员')).toBeInTheDocument();
    expect(dialog.getByText(`审核时间：${new Date(reviewedAt).toLocaleString('zh-CN')}`)).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: '审核通过' })).not.toBeInTheDocument();
  });

  it.each(['ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'])('成员自己的%s工作副本展示审核人且仍可编辑', (reviewStatus) => {
    const query = usePersonalDiffs();
    const reviewedAt = '2026-10-09T08:48:26.730Z';
    const workingCopy = query.data.items[1];
    query.data.canManage = false;
    query.data.items = [];
    query.data.myWorkingCopy = {
      ...workingCopy,
      reviewStatus, pending: false, reviewedBy: { id: 'reviewer-1', name: '审核管理员' },
      enterpriseReviewedAt: reviewedAt,
      rejectionReason: reviewStatus === 'ENTERPRISE_REJECTED' ? '请补充内容' : null,
    };

    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="member" />);

    expect(screen.getByText('审核人：审核管理员')).toBeInTheDocument();
    expect(screen.getByText(`审核时间：${new Date(reviewedAt).toLocaleString('zh-CN')}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑' })).toBeEnabled();
    if (reviewStatus === 'ENTERPRISE_REJECTED') expect(screen.getByText('驳回原因：请补充内容')).toBeInTheDocument();
  });

  it('审核人姓名为空时显示成员ID，不混用提交人姓名', () => {
    const query = usePersonalDiffs();
    query.data.items = [{
      ...query.data.items[1], ...reviewFields(false), reviewStatus: 'ENTERPRISE_APPROVED',
      pending: false, reviewedBy: { id: 'reviewer-1', name: null },
    }];

    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);

    expect(screen.getByText('审核人：reviewer-1')).toBeInTheDocument();
    expect(screen.queryByText('审核人：普通成员')).not.toBeInTheDocument();
  });

  it('历史记录没有审核人时只显示已有审核时间', () => {
    const query = usePersonalDiffs();
    const reviewedAt = '2026-10-09T08:48:26.730Z';
    query.data.items = [{
      ...query.data.items[1], ...reviewFields(false), reviewStatus: 'ENTERPRISE_APPROVED',
      pending: false, enterpriseReviewedAt: reviewedAt, reviewedBy: null,
    }];

    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);

    expect(screen.queryByText(/^审核人：/)).not.toBeInTheDocument();
    expect(screen.getByText(`审核时间：${new Date(reviewedAt).toLocaleString('zh-CN')}`)).toBeInTheDocument();
  });
});
