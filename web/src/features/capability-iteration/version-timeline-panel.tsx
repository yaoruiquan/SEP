'use client';

import { useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  FileText,
  GitBranch,
  GitFork,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import {
  usePublishEnterpriseVersion,
  useSelectEffectiveVersion,
  useSelectPersonalVersion,
  type TimelineVersion,
  type VersionTimeline,
} from './use-capability-iteration';
import {
  useCreateEnterpriseSkillVersion,
  useSubmitPlatformSkillReview,
} from '@/features/skill-version/use-skill-version';

/**
 * 版本时间线。
 *
 * 会议要求「采纳后保留版本记录，支持查看历史版本和回滚」。回滚在实现上就是
 * 把生效版本选回旧的那一个 —— 不删不改历史，只改「现在用哪个」。
 */
export function VersionTimelinePanel({ timeline, initialSubscriptionId }: {
  timeline: VersionTimeline;
  initialSubscriptionId?: string;
}) {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [expandedId, setExpandedId] = useState<string>();
  const selectVersion = useSelectEffectiveVersion(timeline.capability.id);
  const selectPersonal = useSelectPersonalVersion(timeline.capability.id);
  const createVersion = useCreateEnterpriseSkillVersion();
  const publishVersion = usePublishEnterpriseVersion(timeline.capability.id);
  const submitToPlatform = useSubmitPlatformSkillReview();

  const [selection, setSelection] = useState({ initialSubscriptionId, subscriptionId: initialSubscriptionId });
  // URL 入口变化时重新定位；同一入口的数据刷新不覆盖手动选择。
  const subscriptionId = selection.initialSubscriptionId === initialSubscriptionId
    ? selection.subscriptionId
    : initialSubscriptionId;
  const selectedSubscription = timeline.subscriptions.find((item) => item.subscriptionId === subscriptionId)
    ?? timeline.subscriptions.find((item) => item.subscriptionId === timeline.subscriptionId && item.canSelectPersonal)
    ?? timeline.subscriptions.find((item) => item.canSelectPersonal)
    ?? timeline.subscriptions.find((item) => item.subscriptionId === timeline.subscriptionId)
    ?? timeline.subscriptions[0];
  const currentId = selectedSubscription ? selectedSubscription.enterpriseVersionId : timeline.currentVersionId;
  const effectiveId = selectedSubscription?.effectiveVersionId;
  const selecting = selectVersion.isPending || selectPersonal.isPending;
  const effectiveVersion = timeline.versions.find((version) => version.id === effectiveId);
  const effectiveLabel = effectiveVersion
    ? versionLabel(effectiveVersion)
    : effectiveId
      ? scopeLabel(selectedSubscription?.effectiveVersionScope ?? null)
      : '暂无可用版本';
  const parentVersion = timeline.versions.find((version) => version.id === currentId) ?? timeline.versions.find((version) => version.status === 'PLATFORM_APPROVED');

  const createDraft = () => {
    if (!selectedSubscription || !parentVersion) return;
    createVersion.mutate(
      { subscriptionId: selectedSubscription.subscriptionId, capabilityId: timeline.capability.id, parentVersionId: parentVersion.id, changeSummary: `基于 v${parentVersion.version} 创建` },
      {
        onSuccess: (version) => { toast.success('企业版本草稿已创建'); window.location.href = `/skills/${version.id}/edit?returnTo=/capabilities/${timeline.capability.id}`; },
        onError: (error) => toast.error(error instanceof Error ? error.message : '创建版本失败'),
      },
    );
  };

  const setEffective = (version: TimelineVersion) => {
    // 必须用**选中的**订阅，不能用 timeline.subscriptionId ——
    // 后者只是后端授权校验时命中的第一条，切版按雇佣关系生效，
    // 用错了就会「选了员工 B，切版切在员工 A 身上」，而界面上看不出来。
    const targetSubscriptionId = selectedSubscription?.subscriptionId ?? timeline.subscriptionId;
    selectVersion.mutate(
      { subscriptionId: targetSubscriptionId, versionId: version.id },
      {
        onSuccess: () =>
          toast.success(
            selectedSubscription
              ? `${selectedSubscription.employeeName} 的企业默认已切换到 ${versionLabel(version)}`
              : `企业默认已切换到 ${versionLabel(version)}`,
          ),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : '切换版本失败'),
      },
    );
  };

  const setPersonal = (versionId: string | null) => {
    if (!selectedSubscription?.canSelectPersonal) return;
    selectPersonal.mutate(
      { subscriptionId: selectedSubscription.subscriptionId, versionId },
      {
        onSuccess: () => toast.success(
          versionId === null ? '已跟随企业默认' : '个人使用版本已切换',
          `${selectedSubscription.employeeName}：仅影响你在该订阅下的使用${versionId === null ? '，个人副本仍保留' : ''}`,
        ),
        onError: (error) => toast.error(error instanceof Error ? error.message : '个人选版失败'),
      },
    );
  };

  return (
    <div className="space-y-4">
      {timeline.subscriptions.length > 1 && (
        <label className="block text-xs text-gtext-muted">
          当前操作员工
          <select value={selectedSubscription?.subscriptionId ?? ''} disabled={selecting} onChange={(event) => setSelection({ initialSubscriptionId, subscriptionId: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-glassline bg-glass-1 px-3 text-xs text-gtext-primary">
            {timeline.subscriptions.map((item) => <option key={item.subscriptionId} value={item.subscriptionId}>{item.employeeName}</option>)}
          </select>
        </label>
      )}
      {selectedSubscription && (
        <section className="space-y-2 rounded-glass-lg border border-glassline bg-glass-1 px-3.5 py-3" aria-label="个人使用版本">
          <h3 className="text-sm font-semibold text-gtext-primary">个人使用版本</h3>
          {selectedSubscription.canSelectPersonal ? (
            <>
              <p className="text-xs text-gtext-secondary">
                我当前使用：{effectiveLabel} · {selectedSubscription.personalSelectionMode === 'PINNED'
                  ? '已固定个人选择'
                  : selectedSubscription.personalSelectionMode === 'FOLLOW_ENTERPRISE'
                    ? '跟随企业默认'
                    : '自动选择'}
              </p>
              <p className="text-[11px] leading-5 text-gtext-muted">
                仅影响你在 {selectedSubscription.employeeName} 订阅下的使用，不改变其他成员或其他订阅。
                跟随企业会暂停使用个人副本，但不会删除副本。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="glass" className="h-7 px-2.5 text-[11px]"
                  disabled={selecting || selectedSubscription.personalSelectionMode === 'FOLLOW_ENTERPRISE'}
                  onClick={() => setPersonal(null)}>
                  跟随企业
                </Button>
                {timeline.myPersonalVersionId && (
                  <Button size="sm" variant="glass-primary" className="h-7 px-2.5 text-[11px]"
                    disabled={selecting || (selectedSubscription.personalSelectionMode === 'PINNED' && selectedSubscription.personalVersionId === timeline.myPersonalVersionId)}
                    onClick={() => setPersonal(timeline.myPersonalVersionId)}>
                    使用我的副本
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-gtext-muted">此订阅未授权给你，不能选择个人使用版本；管理权限不等于使用授权。</p>
          )}
        </section>
      )}
      {timeline.canManage && (
        <p className="text-[11px] leading-5 text-gtext-muted">
          企业默认是该订阅的共享设置，仅影响跟随默认的成员；不会覆盖成员的显式个人选择。
        </p>
      )}
      {timeline.versions.length === 0 && (
        <p className="rounded-glass-lg border border-dashed border-glassline px-4 py-8 text-center text-xs text-gtext-muted">这个技能还没有任何版本记录</p>
      )}
      {timeline.canManage && parentVersion && selectedSubscription && (
        <div className="flex flex-wrap items-center gap-2 rounded-glass-lg border border-glassline-brand bg-gbrand/[0.05] px-3.5 py-3">
          <span className="text-xs text-gtext-secondary">为 {selectedSubscription.employeeName} 创建企业版本</span>
          <Button size="sm" variant="glass-primary" className="h-7 px-2.5 text-[11px]" onClick={createDraft} loading={createVersion.isPending}><GitFork className="h-3 w-3" /> 创建草稿</Button>
        </div>
      )}
      <ol className="space-y-0">
      {timeline.versions.map((version, index) => {
        const status = version.status === 'PERSONAL_ACTIVE'
          ? { ...SKILL_VERSION_STATUS[version.status], label: '个人副本 · 已保存' }
          : SKILL_VERSION_STATUS[version.status];
        const expanded = expandedId === version.id;
        const isEnterprise = version.scope === 'ENTERPRISE';
        const isCurrent = version.id === currentId;
        const isEffective = selectedSubscription?.canSelectPersonal && version.id === effectiveId;
        const approved =
          (version.scope === 'PLATFORM' && version.status === 'PLATFORM_APPROVED') ||
          (isEnterprise && version.status === 'ENTERPRISE_APPROVED');
        const selectable = timeline.canManage && Boolean(selectedSubscription) && !isCurrent && approved;
        const approvedPersonal = version.scope === 'PERSONAL' &&
          version.status === 'ENTERPRISE_APPROVED' && Boolean(currentUserId) && version.ownerId === currentUserId;
        const personalSelectable = selectedSubscription?.canSelectPersonal &&
          (approved || approvedPersonal || (version.id === timeline.myPersonalVersionId && version.scope === 'PERSONAL' && version.status === 'PERSONAL_ACTIVE'));
        const personallyPinned = selectedSubscription?.personalSelectionMode === 'PINNED' && selectedSubscription.personalVersionId === version.id;

        // 投稿到平台市场。
        //
        // 后端 `submitPlatformReview` 早就写好了（只收 ENTERPRISE_APPROVED，
        // 且靠 sourceVersionId 唯一约束保证一份只投一次），前端 hook
        // `useSubmitPlatformSkillReview` 也早就定义了 —— 但**没有任何组件调用它**。
        // 于是企业改好的版本没有任何出口，平台侧的能力审核队列长期为空。
        // hasPlatformSubmission 也是后端一直在返回、一直没人读的字段。
        const promotable =
          timeline.canManage &&
          isEnterprise &&
          version.status === 'ENTERPRISE_APPROVED' &&
          !version.hasPlatformSubmission;

        return (
          <li key={version.id} className="relative flex gap-3">
            {index !== timeline.versions.length - 1 && (
              <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-glassline" aria-hidden />
            )}

            <span
              className={cn(
                'relative z-10 mt-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2',
                isCurrent
                  ? 'border-gsuccess bg-gsuccess text-white'
                  : isEnterprise
                    ? 'border-glassline-brand bg-gbrand/10 text-gbrand-text'
                    : 'border-glassline bg-glass-2 text-gtext-muted',
              )}
            >
              {isCurrent ? (
                <Check className="h-4 w-4" strokeWidth={3} />
              ) : isEnterprise ? (
                <GitBranch className="h-3.5 w-3.5" />
              ) : (
                <CircleDot className="h-3.5 w-3.5" />
              )}
            </span>

            <div className="min-w-0 flex-1 pb-4">
              <div
                className={cn(
                  'rounded-glass-lg border px-3.5 py-3 transition-colors',
                  isCurrent
                    ? 'border-gsuccess/40 bg-gsuccess/[0.06]'
                    : 'border-glassline bg-glass-1',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? undefined : version.id)}
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={expanded}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="text-sm font-semibold text-gtext-primary">{versionLabel(version)}</p>
                      <span
                        className={cn(
                          'rounded-glass-pill border px-1.5 py-0.5 text-[10px] font-medium',
                          status.className,
                        )}
                      >
                        {status.label}
                      </span>
                      {isCurrent && (
                        <span className="rounded-glass-pill bg-gsuccess px-1.5 py-0.5 text-[10px] font-bold text-white">
                          企业默认
                        </span>
                      )}
                      {isEffective && (
                        <span className="rounded-glass-pill bg-gbrand/15 px-1.5 py-0.5 text-[10px] font-medium text-gbrand-text">我当前使用</span>
                      )}
                      {version.hasPlatformSubmission && (
                        <span className="inline-flex items-center gap-1 rounded-glass-pill border border-glassline bg-glass-2 px-1.5 py-0.5 text-[10px] text-gtext-muted">
                          <ShieldCheck className="h-2.5 w-2.5" />
                          已投稿平台
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-[11px] text-gtext-muted">
                      {version.createdBy.name ?? '未知'} 创建 ·{' '}
                      {new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false })}
                    </p>

                    {version.changeSummary && (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-gtext-secondary">
                        {version.changeSummary}
                      </p>
                    )}
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {personalSelectable && (
                      <Button size="sm" variant="glass-primary" className="h-7 px-2.5 text-[11px]"
                        onClick={() => setPersonal(version.id)} disabled={selecting || personallyPinned}>
                        {personallyPinned ? '已设为个人使用' : version.scope === 'PERSONAL' ? '使用此副本' : '设为个人使用'}
                      </Button>
                    )}
                    {timeline.canManage && isEnterprise && (version.status === 'DRAFT' || version.status === 'ENTERPRISE_REJECTED') && (
                      <Link href={`/skills/${version.id}/edit?returnTo=/capabilities/${timeline.capability.id}`} aria-label="编辑企业版本" className="grid h-7 w-7 place-items-center rounded-glass-md text-gtext-muted hover:bg-glass-3 hover:text-gtext-primary"><Pencil className="h-3.5 w-3.5" /></Link>
                    )}
                    {/* 会议否掉提审流：草稿由管理员一步发布，没有「提交审核 → 自己批准」 */}
                    {timeline.canManage && isEnterprise && (version.status === 'DRAFT' || version.status === 'ENTERPRISE_REJECTED') && (
                      <Button size="sm" variant="glass-primary" className="h-7 px-2 text-[11px]" onClick={() => publishVersion.mutate(version.id, { onSuccess: (result) => toast.success(`${versionLabel(version)} 已发布并生效`, `对 ${result.affectedSubscriptions} 个雇佣关系生效`), onError: (error) => toast.error(error instanceof Error ? error.message : '发布失败') })} loading={publishVersion.isPending}><ShieldCheck className="h-3 w-3" /> 发布并生效</Button>
                    )}
                    {selectable && (
                      <Button
                        size="sm"
                        variant="glass"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => setEffective(version)}
                        disabled={selecting}
                      >
                        <RotateCcw className="h-3 w-3" />
                        设为企业默认
                      </Button>
                    )}
                    {promotable && (
                      <Button
                        size="sm"
                        variant="glass"
                        className="h-7 px-2.5 text-[11px]"
                        loading={submitToPlatform.isPending}
                        onClick={() =>
                          submitToPlatform.mutate(version.id, {
                            onSuccess: () =>
                              toast.success(
                                `${versionLabel(version)} 已投稿到平台`,
                                '平台运营审核通过后会成为公共版本，你的企业版本不受影响',
                              ),
                            onError: (error) =>
                              toast.error(error instanceof Error ? error.message : '投稿失败'),
                          })
                        }
                      >
                        <Upload className="h-3 w-3" />
                        投稿到平台
                      </Button>
                    )}
                    {timeline.canManage && isEnterprise && version.hasPlatformSubmission && (
                      <span className="rounded-glass-md border border-glassline bg-glass-2 px-2 py-1 text-[11px] text-gtext-muted">
                        已投稿
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? undefined : version.id)}
                      aria-label={expanded ? '收起' : '展开'}
                      className="grid h-7 w-7 place-items-center rounded-glass-md text-gtext-muted transition-colors hover:bg-glass-3 hover:text-gtext-primary"
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="mt-3 space-y-2.5 border-t border-glassline pt-3">
                    {version.rejectionReason && (
                      <p className="rounded-glass-md border border-gdanger/25 bg-gdanger/[0.06] px-2.5 py-2 text-[11px] leading-5 text-gdanger">
                        驳回原因：{version.rejectionReason}
                      </p>
                    )}

                    {version.reviews.length > 0 ? (
                      <div>
                        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gtext-muted">
                          <Clock className="h-3 w-3" />
                          审核历史
                        </p>
                        <div className="mt-1.5 space-y-1.5">
                          {version.reviews.map((review) => (
                            <div
                              key={review.id}
                              className="rounded-glass-md border border-glassline bg-glass-2 px-2.5 py-1.5"
                            >
                              <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                                <span className="font-medium text-gtext-primary">
                                  {review.actorType === 'ENTERPRISE' ? '企业' : '平台'}
                                  {review.decision === 'APPROVE' ? '通过' : '驳回'}
                                </span>
                                <span className="text-gtext-muted">{review.reviewer.name ?? '未知'}</span>
                                <span className="ml-auto tabular-nums text-gtext-muted">
                                  {new Date(review.createdAt).toLocaleString('zh-CN', { hour12: false })}
                                </span>
                              </div>
                              {review.comment && (
                                <p className="mt-1 text-[11px] leading-5 text-gtext-secondary">{review.comment}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="flex items-center gap-1.5 text-[11px] text-gtext-muted">
                        <FileText className="h-3 w-3" />
                        还没有审核记录
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
      </ol>
    </div>
  );
}

function versionLabel(version: TimelineVersion): string {
  return version.scope === 'PERSONAL' ? '我的副本' : `${scopeLabel(version.scope)} ${version.version}`;
}

function scopeLabel(scope: TimelineVersion['scope'] | null): string {
  if (scope === 'PERSONAL') return '我的副本';
  if (scope === 'ENTERPRISE') return '企业版';
  if (scope === 'PLATFORM') return '平台版';
  return '未知版本';
}
