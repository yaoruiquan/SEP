'use client';

import { useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  FileText,
  GitBranch,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import { cn } from '@/lib/utils';
import {
  useSelectEffectiveVersion,
  type TimelineVersion,
  type VersionTimeline,
} from './use-capability-iteration';

/**
 * 版本时间线。
 *
 * 会议要求「采纳后保留版本记录，支持查看历史版本和回滚」。回滚在实现上就是
 * 把生效版本选回旧的那一个 —— 不删不改历史，只改「现在用哪个」。
 */
export function VersionTimelinePanel({ timeline }: { timeline: VersionTimeline }) {
  const [expandedId, setExpandedId] = useState<string>();
  const selectVersion = useSelectEffectiveVersion(timeline.capability.id);

  const setEffective = (version: TimelineVersion) => {
    selectVersion.mutate(
      { subscriptionId: timeline.subscriptionId, versionId: version.id },
      {
        onSuccess: () => toast.success(`已切换到 ${versionLabel(version)}`),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : '切换版本失败'),
      },
    );
  };

  if (timeline.versions.length === 0) {
    return (
      <p className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-8 text-center text-xs text-gtext-muted">
        这个技能还没有任何版本记录
      </p>
    );
  }

  return (
    <ol className="space-y-0">
      {timeline.versions.map((version, index) => {
        const status = SKILL_VERSION_STATUS[version.status];
        const expanded = expandedId === version.id;
        const isEnterprise = version.scope === 'ENTERPRISE';
        // 能被选为生效版本的前提：平台已通过，或企业内部已通过。
        // 草稿和待审版本不能生效 —— 那等于绕过审核流。
        const selectable =
          timeline.canManage &&
          !version.isCurrent &&
          (version.status === 'PLATFORM_APPROVED' || version.status === 'ENTERPRISE_APPROVED');

        return (
          <li key={version.id} className="relative flex gap-3">
            {index !== timeline.versions.length - 1 && (
              <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-glassline" aria-hidden />
            )}

            <span
              className={cn(
                'relative z-10 mt-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2',
                version.isCurrent
                  ? 'border-gsuccess bg-gsuccess text-white'
                  : isEnterprise
                    ? 'border-glassline-brand bg-gbrand/10 text-gbrand-text'
                    : 'border-glassline bg-glass-2 text-gtext-muted',
              )}
            >
              {version.isCurrent ? (
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
                  version.isCurrent
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
                      {version.isCurrent && (
                        <span className="rounded-glass-pill bg-gsuccess px-1.5 py-0.5 text-[10px] font-bold text-white">
                          当前生效
                        </span>
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

                  <div className="flex shrink-0 items-center gap-1.5">
                    {selectable && (
                      <Button
                        size="sm"
                        variant="glass"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => setEffective(version)}
                        disabled={selectVersion.isPending}
                      >
                        <RotateCcw className="h-3 w-3" />
                        设为生效
                      </Button>
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
  );
}

function versionLabel(version: TimelineVersion): string {
  return version.scope === 'ENTERPRISE' ? `企业版 ${version.version}` : `平台版 ${version.version}`;
}
