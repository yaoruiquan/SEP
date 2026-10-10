import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionTimelinePanel } from './version-timeline-panel';
import type { TimelineVersion, VersionTimeline } from './use-capability-iteration';

const mocks = vi.hoisted(() => ({ enterprise: vi.fn(), enterprisePending: false, preview: vi.fn(), success: vi.fn() }));
vi.mock('./use-capability-iteration', () => ({
  useSelectEffectiveVersion: () => ({ mutate: mocks.enterprise, isPending: mocks.enterprisePending }),
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: mocks.success, error: vi.fn() } }));
vi.mock('@/features/skill-version/SkillVersionPreviewDialog', () => ({
  SkillVersionPreviewDialog: (props: { versionId: string; source: string }) => {
    mocks.preview(props);
    return <div role="dialog">正文预览 {props.versionId}</div>;
  },
}));
function version(id: string, scope: TimelineVersion['scope'], status: TimelineVersion['status'], isWorkingCopy?: boolean): TimelineVersion {
  return {
    id, capabilityId: 'cap', scope, status, isWorkingCopy, ownerId: 'me', enterpriseId: null,
    version: '1.0.0', parentVersionId: null, sourceVersionId: null, changeSummary: '变更说明',
    createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z',
    createdBy: { id: 'me', name: '提交人' }, enterpriseReviewedBy: null, enterpriseReviewedAt: null,
    rejectionReason: null, reviews: [], hasPlatformSubmission: false, isCurrent: id === 'enterprise',
  };
}
function timeline(canManage = true): VersionTimeline {
  return {
    capability: { id: 'cap', name: '测试技能', description: '' }, canManage,
    currentVersionId: 'enterprise', selectedAt: null, myPersonalVersionId: 'working', subscriptionId: '', subscriptions: [],
    versions: [version('platform', 'PLATFORM', 'PLATFORM_APPROVED'),
      version('enterprise', 'ENTERPRISE', 'ENTERPRISE_APPROVED'),
      version('client', 'PERSONAL', 'PENDING_ENTERPRISE_REVIEW', false),
      version('working', 'PERSONAL', 'PERSONAL_ACTIVE', true),
      version('draft', 'ENTERPRISE', 'DRAFT'), version('archived', 'PLATFORM', 'ARCHIVED'),
      version('personal-approved', 'PERSONAL', 'ENTERPRISE_APPROVED', false)],
  };
}
const row = (index: number) => within(screen.getAllByRole('listitem')[index]);
beforeEach(() => { vi.clearAllMocks(); mocks.enterprisePending = false; });

describe('企业技能启用时间线', () => {
  it('仅管理员可启用非当前的已通过企业或平台版，个人通过记录不能启用', () => {
    const data = timeline();
    data.versions.push(version('old-enterprise', 'ENTERPRISE', 'ENTERPRISE_APPROVED'));
    render(<VersionTimelinePanel timeline={data} />);
    expect(row(1).getByText('已启用')).toBeVisible();
    expect(row(1).queryByRole('button', { name: '启用' })).not.toBeInTheDocument();
    for (const index of [2, 3, 4, 5, 6]) expect(row(index).queryByRole('button', { name: '启用' })).not.toBeInTheDocument();
    fireEvent.click(row(0).getByRole('button', { name: '启用' }));
    expect(mocks.enterprise).toHaveBeenCalledWith({ versionId: 'platform' }, expect.any(Object));
    const callbacks = mocks.enterprise.mock.calls[0][1];
    callbacks.onSuccess();
    expect(mocks.success).toHaveBeenCalledWith('已启用 平台版 1.0.0');
    fireEvent.click(row(7).getByRole('button', { name: '启用' }));
    expect(mocks.enterprise).toHaveBeenLastCalledWith({ versionId: 'old-enterprise' }, expect.any(Object));
  });
  it('普通成员只读，仍可预览正文与审核历史', () => {
    const data = timeline(false);
    data.versions[1].reviews = [{ id: 'review', actorType: 'ENTERPRISE', decision: 'APPROVE', comment: '已确认',
      createdAt: '2026-10-09T00:00:00Z', reviewer: { id: 'admin', name: '审核人' } }];
    render(<VersionTimelinePanel timeline={data} />);
    expect(screen.queryByRole('button', { name: '启用' })).not.toBeInTheDocument();
    fireEvent.click(row(1).getByRole('button', { name: '展开' }));
    expect(row(1).getByText('审核人')).toBeVisible();
    expect(row(1).getByText('已确认')).toBeVisible();
    fireEvent.click(row(1).getByRole('button', { name: '查看内容' }));
    expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ versionId: 'enterprise', source: 'enterprise' }));
  });
  it('可靠区分客户端和历史 Web 来源；字段缺失仅显示个人提交', () => {
    const data = timeline();
    data.versions.push(version('unknown', 'PERSONAL', 'PERSONAL_ACTIVE'));
    render(<VersionTimelinePanel timeline={data} />);
    expect(row(2).getByText('客户端提交 1.0.0')).toBeVisible();
    expect(row(3).getByText('历史 Web 副本 1.0.0')).toBeVisible();
    expect(row(7).getByText('个人提交 1.0.0')).toBeVisible();
  });
  it('历史 PIN 不影响企业当前启用展示，不暴露个人或正文写入口', () => {
    const data = timeline();
    data.subscriptions = [{ subscriptionId: 'sub', employeeId: 'employee', employeeName: '员工', currentVersionId: 'enterprise',
      enterpriseVersionId: 'enterprise', personalVersionId: 'working', personalSelectionMode: 'PINNED',
      effectiveVersionId: 'working', effectiveVersionScope: 'PERSONAL', canSelectPersonal: true, selectedAt: null }];
    render(<VersionTimelinePanel timeline={data} />);
    expect(screen.getByRole('region', { name: '企业当前启用' })).toHaveTextContent('企业版 1.0.0');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(设为个人使用|使用此副本|使用我的副本|跟随企业|投稿到平台|创建|编辑)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '编辑企业版本' })).not.toBeInTheDocument();
  });
  it('启用请求进行中不可重复提交', () => {
    mocks.enterprisePending = true;
    render(<VersionTimelinePanel timeline={timeline()} />);
    const button = row(0).getByRole('button', { name: '启用' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.enterprise).not.toHaveBeenCalled();
  });
});
