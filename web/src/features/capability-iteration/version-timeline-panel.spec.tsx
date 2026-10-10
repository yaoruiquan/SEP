import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate, VersionTimelinePanel } from './version-timeline-panel';
import type { TimelineVersion, VersionTimeline } from './use-capability-iteration';

const mocks = vi.hoisted(() => ({ enterprise: vi.fn(), pending: false, preview: vi.fn(), success: vi.fn() }));
vi.mock('./use-capability-iteration', () => ({ useSelectEffectiveVersion: () => ({ mutate: mocks.enterprise, isPending: mocks.pending }) }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: mocks.success, error: vi.fn() } }));
vi.mock('@/features/skill-version/SkillVersionPreviewDialog', () => ({
  SkillVersionPreviewDialog: (props: { versionId: string; source: string; details?: ReactNode }) => { mocks.preview(props); return <div role="dialog">正文预览 {props.versionId}{props.details}</div>; },
}));
function version(id: string, scope: TimelineVersion['scope'], status: TimelineVersion['status']): TimelineVersion {
  return { id, capabilityId: 'cap', scope, status, ownerId: 'me', enterpriseId: null, version: '1.0.0',
    parentVersionId: null, sourceVersionId: null, changeSummary: `变更 ${id}`, sourceSubmissionId: null,
    createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z', createdBy: { id: 'me', name: '提交人' },
    enterpriseReviewedBy: null, enterpriseReviewedAt: null, rejectionReason: null, reviews: [], hasPlatformSubmission: false, isCurrent: id === 'enterprise' };
}
function timeline(canManage = true): VersionTimeline {
  return { capability: { id: 'cap', name: '测试技能', description: '' }, canManage, currentVersionId: 'enterprise',
    selectedAt: null, myPersonalVersionId: 'working', subscriptionId: '', subscriptions: [],
    versions: [version('platform', 'PLATFORM', 'PLATFORM_APPROVED'), version('enterprise', 'ENTERPRISE', 'ENTERPRISE_APPROVED'),
      version('client', 'PERSONAL', 'PENDING_ENTERPRISE_REVIEW'), version('working', 'PERSONAL', 'PERSONAL_ACTIVE'),
      version('draft', 'ENTERPRISE', 'DRAFT'), version('archived', 'PLATFORM', 'ARCHIVED'), version('personal-approved', 'PERSONAL', 'ENTERPRISE_APPROVED')] };
}
const row = (index: number) => within(screen.getAllByRole('listitem')[index]);
beforeEach(() => { vi.clearAllMocks(); mocks.pending = false; });

describe('发布版本', () => {
  it('只保留正式通过的平台与企业版本，当前置顶，不承载审核流水', () => {
    const data = timeline();
    data.versions[1].reviews = [{ id: 'review', actorType: 'ENTERPRISE', decision: 'APPROVE', comment: '私有审核意见', createdAt: '2026-10-09T00:00:00Z', reviewer: { id: 'admin', name: '审核人' } }];
    render(<VersionTimelinePanel timeline={data} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(row(0).getByText('企业版 1.0.0')).toBeVisible();
    expect(row(1).getByText('平台版 1.0.0')).toBeVisible();
    expect(screen.queryByText('私有审核意见')).not.toBeInTheDocument();
    expect(screen.queryByText(/客户端提交|历史 Web 副本|个人提交/)).not.toBeInTheDocument();
  });
  it('启用经过二次确认，仅管理员可操作其他正式版本', () => {
    render(<VersionTimelinePanel timeline={timeline()} />);
    expect(row(0).queryByRole('button', { name: '启用' })).not.toBeInTheDocument();
    fireEvent.click(row(1).getByRole('button', { name: '启用' }));
    expect(mocks.enterprise).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('历史发布版本和审核结果保持不变');
    fireEvent.click(screen.getByRole('button', { name: '确认启用' }));
    expect(mocks.enterprise).toHaveBeenCalledWith({ versionId: 'platform' }, expect.any(Object));
    mocks.enterprise.mock.calls[0][1].onSuccess();
    expect(mocks.success).toHaveBeenCalledWith('已启用 平台版 1.0.0');
  });
  it('成员只读但可预览内容，缺省来源不生成他人提交链接', () => {
    render(<VersionTimelinePanel timeline={timeline(false)} />);
    expect(screen.queryByRole('button', { name: '启用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '来源提交' })).not.toBeInTheDocument();
    fireEvent.click(row(0).getByRole('button', { name: '查看详情' }));
    expect(mocks.preview).toHaveBeenLastCalledWith(expect.objectContaining({ versionId: 'enterprise', source: 'enterprise' }));
  });
  it('来源筛选和授权来源深链接可定位具体提交', () => {
    const data = timeline(); data.versions[1].sourceSubmissionId = 'submission';
    render(<VersionTimelinePanel timeline={data} />);
    expect(screen.getByRole('link', { name: '来源提交' })).toHaveAttribute('href', '/capabilities/cap?tab=changes&submission=submission');
    fireEvent.change(screen.getByRole('combobox', { name: '版本来源' }), { target: { value: 'PLATFORM' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('企业版 1.0.0')).not.toBeInTheDocument();
  });
  it('发布详情保留真实发布时间与授权来源提交入口', () => {
    const data = timeline();
    data.versions[1].sourceSubmissionId = 'submission';
    data.versions[1].enterpriseReviewedAt = '2026-10-10T01:00:00Z';
    const navigate = vi.fn();
    render(<VersionTimelinePanel timeline={data} releaseId="enterprise" onNavigate={navigate} />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/发布时间/)).toBeVisible();
    fireEvent.click(dialog.getByRole('link', { name: '来源提交' }));
    expect(navigate).toHaveBeenCalledWith({ tab: 'changes', submission: 'submission', release: null });
  });
  it('平台历史草稿按真实发布时间排序，列表与详情显示相同发布时点', () => {
    const data = timeline();
    const publishedAt = '2026-10-10T01:00:00Z';
    Object.assign(data.versions[0], {
      createdAt: '2026-10-01T00:00:00Z', platformReviewedAt: publishedAt,
      enterpriseReviewedAt: '2026-09-30T00:00:00Z',
    });
    data.versions.push(Object.assign(version('older-platform', 'PLATFORM', 'PLATFORM_APPROVED'), {
      createdAt: '2026-10-08T00:00:00Z', platformReviewedAt: '2026-10-08T01:00:00Z',
    }));
    render(<VersionTimelinePanel timeline={data} releaseId="platform" onNavigate={vi.fn()} />);
    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('data-release-id')))
      .toEqual(['enterprise', 'platform', 'older-platform']);
    expect(row(1).getByText('发布时间')).toBeVisible();
    expect(row(1).getByText(formatDate(publishedAt))).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveTextContent(`发布时间：${formatDate(publishedAt)}`);
  });
  it('缺少平台发布时间的历史版本使用创建时间，不误用企业审核时间', () => {
    const data = timeline();
    Object.assign(data.versions[0], { platformReviewedAt: null, enterpriseReviewedAt: '2026-10-10T01:00:00Z' });
    render(<VersionTimelinePanel timeline={data} releaseId="platform" onNavigate={vi.fn()} />);
    expect(row(1).getByText('创建时间')).toBeVisible();
    expect(row(1).getByText(formatDate(data.versions[0].createdAt))).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveTextContent(`创建时间：${formatDate(data.versions[0].createdAt)}`);
  });
  it('企业发布时间仍按企业审核时点读取，不受平台字段影响', () => {
    const data = timeline();
    const publishedAt = '2026-10-10T02:00:00Z';
    Object.assign(data.versions[1], { enterpriseReviewedAt: publishedAt, platformReviewedAt: '2026-10-08T01:00:00Z' });
    render(<VersionTimelinePanel timeline={data} releaseId="enterprise" onNavigate={vi.fn()} />);
    expect(row(0).getByText('发布时间')).toBeVisible();
    expect(row(0).getByText(formatDate(publishedAt))).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveTextContent(`发布时间：${formatDate(publishedAt)}`);
  });
  it('深链接只能预览正式版本，切换URL后不残留旧弹窗', () => {
    const navigate = vi.fn(); const data = timeline();
    const view = render(<VersionTimelinePanel timeline={data} releaseId="platform" onNavigate={navigate} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('platform');
    view.rerender(<VersionTimelinePanel timeline={data} releaseId={null} onNavigate={navigate} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(<VersionTimelinePanel timeline={data} releaseId="client" onNavigate={navigate} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('不存在或当前不可查看');
  });
  it('来源筛选可从URL恢复并在导航时保留', () => {
    const navigate = vi.fn();
    const view = render(<VersionTimelinePanel timeline={timeline()} sourceFilter="PLATFORM" onNavigate={navigate} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('平台版 1.0.0')).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: '版本来源' }), { target: { value: 'ENTERPRISE' } });
    expect(navigate).toHaveBeenCalledWith({ source: 'ENTERPRISE' });
    view.rerender(<VersionTimelinePanel timeline={timeline()} sourceFilter="ENTERPRISE" onNavigate={navigate} />);
    expect(screen.getByText('企业版 1.0.0')).toBeVisible();
    expect(screen.queryByText('平台版 1.0.0')).not.toBeInTheDocument();
  });
  it('进行中禁用启用，列表没有个人选版或正文修改入口', () => {
    mocks.pending = true; render(<VersionTimelinePanel timeline={timeline()} />);
    expect(screen.getByRole('button', { name: '启用' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /设为个人使用|使用我的副本|创建|编辑/ })).not.toBeInTheDocument();
  });
});
