import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionTimelinePanel } from './version-timeline-panel';
import { useAuthStore } from '@/lib/auth-store';
import type { TimelineVersion, VersionTimeline } from './use-capability-iteration';

const mocks = vi.hoisted(() => ({ personal: vi.fn(), enterprise: vi.fn(), personalPending: false, enterprisePending: false }));
vi.mock('./use-capability-iteration', () => ({
  useSelectPersonalVersion: () => ({ mutate: mocks.personal, isPending: mocks.personalPending }),
  useSelectEffectiveVersion: () => ({ mutate: mocks.enterprise, isPending: mocks.enterprisePending }),
  usePublishEnterpriseVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/skill-version/use-skill-version', () => ({
  useCreateEnterpriseSkillVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitPlatformSkillReview: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function version(id: string, scope: TimelineVersion['scope'], status: TimelineVersion['status']): TimelineVersion {
  return {
    id, capabilityId: 'cap', scope, status, version: '1.0.0', enterpriseId: null,
    parentVersionId: null, sourceVersionId: null, changeSummary: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    createdBy: { id: 'me', name: '我' }, enterpriseReviewedBy: null,
    enterpriseReviewedAt: null, rejectionReason: null, reviews: [],
    hasPlatformSubmission: false, isCurrent: false,
  };
}
function timeline(canManage = false): VersionTimeline {
  return {
    capability: { id: 'cap', name: '技能', description: '' }, subscriptionId: 'sub-a',
    canManage, currentVersionId: 'enterprise', selectedAt: null, myPersonalVersionId: 'mine',
    subscriptions: ['a', 'b'].map((id) => ({
      subscriptionId: `sub-${id}`, employeeId: `employee-${id}`, employeeName: `员工${id}`,
      currentVersionId: 'enterprise', enterpriseVersionId: 'enterprise', selectedAt: null,
      personalVersionId: 'mine', personalSelectionMode: 'PINNED', effectiveVersionId: 'mine',
      effectiveVersionScope: 'PERSONAL', canSelectPersonal: true,
    })),
    versions: [version('platform', 'PLATFORM', 'PLATFORM_APPROVED'),
      version('enterprise', 'ENTERPRISE', 'ENTERPRISE_APPROVED'),
      version('mine', 'PERSONAL', 'PERSONAL_ACTIVE'),
      version('other', 'PERSONAL', 'PERSONAL_ACTIVE'),
      version('draft', 'ENTERPRISE', 'DRAFT'),
      version('archived', 'PLATFORM', 'ARCHIVED')],
  };
}
const row = (index: number) => within(screen.getAllByRole('listitem')[index]);

beforeEach(() => {
  vi.clearAllMocks(); mocks.personalPending = false; mocks.enterprisePending = false;
  useAuthStore.setState({ user: { id: 'me', name: '我', email: 'me@example.test', avatar: null, role: 'USER' } });
});

describe('VersionTimelinePanel 个人选版', () => {
  it('入口指定员工 B 时个人操作使用 B，企业操作不传订阅', () => {
    render(<VersionTimelinePanel timeline={timeline(true)} initialSubscriptionId="sub-b" />);
    expect(screen.getByRole('combobox')).toHaveValue('sub-b');
    fireEvent.click(row(0).getByRole('button', { name: '设为个人使用' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-b', versionId: 'platform' }, expect.any(Object));
    fireEvent.click(row(0).getByRole('button', { name: '设为企业默认' }));
    expect(mocks.enterprise).toHaveBeenCalledWith({ versionId: 'platform' }, expect.any(Object));
  });

  it.each([undefined, 'unknown-subscription'])('入口 %s 不匹配时回退授权订阅，不默认管理但未授权的 A', (initialSubscriptionId) => {
    const data = timeline(true);
    data.subscriptions[0].canSelectPersonal = false;
    render(<VersionTimelinePanel timeline={data} initialSubscriptionId={initialSubscriptionId} />);
    expect(screen.getByRole('combobox')).toHaveValue('sub-b');
    fireEvent.click(screen.getByRole('button', { name: '跟随企业' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-b', versionId: null }, expect.any(Object));
  });

  it('没有个人授权时仍回退管理订阅，不能个人选版', () => {
    const data = timeline(true);
    data.subscriptions.forEach((item) => { item.canSelectPersonal = false; });
    render(<VersionTimelinePanel timeline={data} initialSubscriptionId="unknown-subscription" />);
    expect(screen.getByRole('combobox')).toHaveValue('sub-a');
    expect(screen.queryByRole('button', { name: '跟随企业' })).not.toBeInTheDocument();
    expect(row(0).getByRole('button', { name: '设为企业默认' })).toBeEnabled();
  });

  it('入口不变时保留手动选择；入口变化时重新定位到新员工', () => {
    const data = timeline();
    const { rerender } = render(<VersionTimelinePanel timeline={data} initialSubscriptionId="sub-a" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sub-b' } });
    rerender(<VersionTimelinePanel timeline={{ ...data }} initialSubscriptionId="sub-a" />);
    expect(screen.getByRole('combobox')).toHaveValue('sub-b');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sub-a' } });
    rerender(<VersionTimelinePanel timeline={data} initialSubscriptionId="sub-b" />);
    expect(screen.getByRole('combobox')).toHaveValue('sub-b');
    fireEvent.click(screen.getByRole('button', { name: '跟随企业' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-b', versionId: null }, expect.any(Object));
  });

  it('普通成员可在每个授权订阅个人选版，绝不调用企业选版', () => {
    render(<VersionTimelinePanel timeline={timeline()} />);
    fireEvent.change(screen.getByRole('combobox', { name: '当前操作员工' }), { target: { value: 'sub-b' } });
    fireEvent.click(row(0).getByRole('button', { name: '设为个人使用' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-b', versionId: 'platform' }, expect.any(Object));
    fireEvent.click(row(1).getByRole('button', { name: '设为个人使用' }));
    expect(mocks.personal).toHaveBeenLastCalledWith({ subscriptionId: 'sub-b', versionId: 'enterprise' }, expect.any(Object));
    expect(mocks.enterprise).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '设为企业默认' })).not.toBeInTheDocument();
  });

  it('跟随企业发送 null 并保留使用副本入口，暂停副本不显示固定已生效', () => {
    const data = timeline();
    const { rerender } = render(<VersionTimelinePanel timeline={data} />);
    fireEvent.click(screen.getByRole('button', { name: '跟随企业' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-a', versionId: null }, expect.any(Object));
    data.subscriptions[0] = { ...data.subscriptions[0], personalSelectionMode: 'FOLLOW_ENTERPRISE', personalVersionId: null,
      effectiveVersionId: 'enterprise', effectiveVersionScope: 'ENTERPRISE' };
    rerender(<VersionTimelinePanel timeline={data} />);
    expect(screen.getByRole('button', { name: '跟随企业' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '使用我的副本' }));
    expect(mocks.personal).toHaveBeenLastCalledWith({ subscriptionId: 'sub-a', versionId: 'mine' }, expect.any(Object));
    expect(row(2).queryByText('我当前使用')).not.toBeInTheDocument();
    expect(screen.queryByText(/我的副本 · 已生效/)).not.toBeInTheDocument();
  });

  it('管理员分开个人使用与企业默认操作，两个版本标记互不混淆', () => {
    render(<VersionTimelinePanel timeline={timeline(true)} />);
    expect(row(1).getByText('企业默认')).toBeInTheDocument();
    expect(row(2).getByText('我当前使用')).toBeInTheDocument();
    expect(row(2).queryByRole('button', { name: '设为企业默认' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sub-b' } });
    fireEvent.click(row(0).getByRole('button', { name: '设为企业默认' }));
    expect(mocks.enterprise).toHaveBeenCalledWith({ versionId: 'platform' }, expect.any(Object));
    fireEvent.click(row(0).getByRole('button', { name: '设为个人使用' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-b', versionId: 'platform' }, expect.any(Object));
  });

  it('管理但无使用授权时保留企业操作，禁止个人操作', () => {
    const data = timeline(true);
    data.subscriptions[0].canSelectPersonal = false;
    render(<VersionTimelinePanel timeline={data} initialSubscriptionId="sub-a" />);
    expect(screen.getByText('未获使用授权')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '跟随企业' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用我的副本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设为个人使用' })).not.toBeInTheDocument();
    expect(row(0).getByRole('button', { name: '设为企业默认' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sub-b' } });
    expect(screen.getByRole('button', { name: '跟随企业' })).toBeEnabled();
  });

  it('其他成员副本、草稿、归档版本不可个人选择', () => {
    render(<VersionTimelinePanel timeline={timeline()} />);
    for (const index of [3, 4, 5]) {
      expect(row(index).queryByRole('button', { name: /个人使用|使用此副本/ })).not.toBeInTheDocument();
    }
  });

  it('AUTO 可明确钉住副本；副本不在历史列表时仍可通过自己的 ID 使用', () => {
    const data = timeline();
    data.subscriptions[0].personalSelectionMode = 'AUTO';
    data.subscriptions[0].personalVersionId = null;
    data.versions = data.versions.filter((item) => item.scope !== 'PERSONAL');
    render(<VersionTimelinePanel timeline={data} />);
    expect(screen.getByText('我当前使用：我的副本 · 自动选择')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '使用我的副本' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-a', versionId: 'mine' }, expect.any(Object));
  });

  it('个人订阅版本为空不影响技能级企业默认标记或默认动作', () => {
    const data = timeline(true);
    data.subscriptions[1].enterpriseVersionId = null;
    data.subscriptions[1].currentVersionId = null;
    data.subscriptions[1].effectiveVersionId = null;
    render(<VersionTimelinePanel timeline={data} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sub-b' } });
    expect(row(1).getByText('企业默认')).toBeInTheDocument();
    expect(row(1).queryByRole('button', { name: '设为企业默认' })).not.toBeInTheDocument();
    fireEvent.click(row(0).getByRole('button', { name: '设为企业默认' }));
    expect(mocks.enterprise).toHaveBeenCalledWith({ versionId: 'platform' }, expect.any(Object));
    expect(screen.getByText(/我当前使用：暂无可用版本/)).toBeInTheDocument();
  });

  it('提交期间禁止重复操作及切换订阅', () => {
    mocks.personalPending = true;
    render(<VersionTimelinePanel timeline={timeline(true)} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '跟随企业' })).toBeDisabled();
    expect(row(0).getByRole('button', { name: '设为个人使用' })).toBeDisabled();
    expect(row(0).getByRole('button', { name: '设为企业默认' })).toBeDisabled();
  });
});


describe('个人送审审核结果选用', () => {
  it.each([false, true])('无任何订阅时仍可查看企业历史，不能编辑或个人选版，管理员=%s', (canManage) => {
    const data = timeline(canManage);
    data.subscriptions = [];
    data.subscriptionId = '';
    data.versions.push(version('enterprise-old', 'ENTERPRISE', 'ENTERPRISE_APPROVED'));
    render(<VersionTimelinePanel timeline={data} />);
    expect(row(1).getByText('企业版 1.0.0')).toBeVisible();
    expect(row(1).getByText('企业默认')).toBeVisible();
    fireEvent.click(row(1).getByRole('button', { name: '展开' }));
    expect(row(1).getByText('还没有审核记录')).toBeVisible();
    expect(screen.queryByRole('link', { name: '编辑企业版本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /设为个人使用|使用此副本|使用我的副本|跟随企业/ })).not.toBeInTheDocument();
    expect(mocks.personal).not.toHaveBeenCalled();
    if (canManage) {
      fireEvent.click(row(0).getByRole('button', { name: '设为企业默认' }));
      expect(mocks.enterprise).toHaveBeenCalledWith({ versionId: 'platform' }, expect.any(Object));
      fireEvent.click(row(6).getByRole('button', { name: '设为企业默认' }));
      expect(mocks.enterprise).toHaveBeenLastCalledWith({ versionId: 'enterprise-old' }, expect.any(Object));
      for (const index of [1, 2, 3, 4, 5]) {
        expect(row(index).queryByRole('button', { name: '设为企业默认' })).not.toBeInTheDocument();
      }
    } else {
      expect(screen.queryByRole('button', { name: '设为企业默认' })).not.toBeInTheDocument();
      expect(mocks.enterprise).not.toHaveBeenCalled();
    }
  });
  it('无订阅管理员切换默认期间禁止重复提交', () => {
    mocks.enterprisePending = true;
    const data = timeline(true);
    data.subscriptions = [];
    data.subscriptionId = '';
    render(<VersionTimelinePanel timeline={data} />);
    const button = row(0).getByRole('button', { name: '设为企业默认' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.enterprise).not.toHaveBeenCalled();
  });
  it('管理员仅有管理订阅时无编辑入口，企业默认操作仍可用', () => {
    const data = timeline(true);
    data.subscriptions.forEach((item) => { item.canSelectPersonal = false; });
    render(<VersionTimelinePanel timeline={data} />);
    expect(screen.queryByRole('link', { name: '编辑企业版本' })).not.toBeInTheDocument();
    expect(row(0).getByRole('button', { name: '设为企业默认' })).toBeEnabled();
    expect(screen.queryByText(/仅影响你在|企业默认对本企业/)).not.toBeInTheDocument();
  });
  it.each(['PERSONAL_ACTIVE', 'PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_REJECTED'] as const)('本人个人版%s可自用，不受企业审核状态限制', (status) => {
    const data = timeline(true);
    data.versions.push({ ...version('own-personal', 'PERSONAL', status), ownerId: 'me' });
    render(<VersionTimelinePanel timeline={data} />);
    fireEvent.click(row(6).getByRole('button', { name: '使用此副本' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-a', versionId: 'own-personal' }, expect.any(Object));
    expect(row(6).queryByRole('button', { name: '设为企业默认' })).not.toBeInTheDocument();
  });
  it('企业草稿没有未预览正文的一键发布或新增入口', () => {
    render(<VersionTimelinePanel timeline={timeline(true)} />);
    expect(screen.queryByRole('button', { name: '发布并生效' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建草稿' })).not.toBeInTheDocument();
  });
  it('本人已通过的送审版可个人选用，不要求等于Web工作副本ID，也不能设企业默认', () => {
    const data = timeline(true);
    data.versions.push({ ...version('submitted-approved', 'PERSONAL', 'ENTERPRISE_APPROVED'), ownerId: 'me' });
    render(<VersionTimelinePanel timeline={data} />);
    const submitted = row(6);
    expect(submitted.getByText('企业已通过')).toBeInTheDocument();
    fireEvent.click(submitted.getByRole('button', { name: '使用此副本' }));
    expect(mocks.personal).toHaveBeenCalledWith({ subscriptionId: 'sub-a', versionId: 'submitted-approved' }, expect.any(Object));
    expect(submitted.queryByRole('button', { name: '设为企业默认' })).not.toBeInTheDocument();
    expect(mocks.enterprise).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'PENDING_ENTERPRISE_REVIEW', ownerId: 'other' },
    { status: 'ENTERPRISE_REJECTED', ownerId: 'other' },
    { status: 'PERSONAL_ACTIVE', ownerId: 'other' },
    { status: 'ENTERPRISE_APPROVED', ownerId: 'other' },
    { status: 'ENTERPRISE_APPROVED', ownerId: undefined },
  ] as const)('不可选送审版 %j', ({ status, ownerId }) => {
    const data = timeline(true);
    data.versions.push({ ...version('submitted', 'PERSONAL', status), ownerId });
    render(<VersionTimelinePanel timeline={data} />);
    expect(row(6).queryByRole('button', { name: '使用此副本' })).not.toBeInTheDocument();
    expect(row(6).queryByRole('button', { name: '设为企业默认' })).not.toBeInTheDocument();
  });
});
