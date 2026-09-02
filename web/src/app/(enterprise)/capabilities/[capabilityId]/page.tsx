'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, GitCompare, ListTree, Sparkles, Users } from 'lucide-react';
import { InsightsPanel } from '@/features/capability-iteration/insights-panel';
import { PersonalChangesPanel } from '@/features/capability-iteration/personal-changes-panel';
import { UsagePanel } from '@/features/capability-iteration/usage-panel';
import { VersionTimelinePanel } from '@/features/capability-iteration/version-timeline-panel';
import { useVersionTimeline } from '@/features/capability-iteration/use-capability-iteration';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { nav } from '@/locales/zh-CN';

type Tab = 'versions' | 'changes' | 'usage' | 'insights';

/**
 * 四个 tab 对应会议纪要2 §6 的四件事，且**封顶四个** ——
 * §6.7 说「目录层级越深越难用」，第五个 tab 就该考虑是不是塞多了。
 *
 * 执行明细原先是独立 tab，现在降级为「使用」tab 里的折叠区：它是使用统计的下钻，
 * 不是一个平级的话题。
 */
const TABS: Array<{ key: Tab; label: string; icon: React.ElementType; adminLabel?: string }> = [
  { key: 'versions', label: '版本', icon: ListTree },
  { key: 'changes', label: '我的副本', adminLabel: '大家的改动', icon: GitCompare },
  { key: 'usage', label: '使用', icon: Users },
  { key: 'insights', label: '迭代建议', icon: Sparkles },
];

export default function CapabilityIterationDetailPage() {
  const params = useParams<{ capabilityId: string }>();
  const searchParams = useSearchParams();
  const capabilityId = params.capabilityId;
  // 列表页的待办区直接跳 ?tab=changes，落地就在改动那一屏
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'versions';
  const [tab, setTab] = useState<Tab>(
    TABS.some((item) => item.key === initialTab) ? initialTab : 'versions',
  );
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  const { data: timeline, isLoading, isError, error } = useVersionTimeline(capabilityId);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-8 w-64 animate-pulse rounded-glass-md bg-glass-2" />
        <div className="h-64 animate-pulse rounded-glass-lg border border-glassline bg-glass-1" />
      </div>
    );
  }

  if (isError || !timeline) {
    const message = error instanceof Error ? error.message : '能力详情加载失败';
    return (
      <div className="mx-auto max-w-4xl">
        <BackLink />
        <p className="mt-4 rounded-glass-lg border border-gdanger/25 bg-gdanger/[0.06] px-4 py-8 text-center text-sm text-gdanger">
          {message}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-8">
      <div>
        <BackLink />
        <h1 className="mt-2.5 text-xl font-bold text-gtext-primary">{timeline.capability.name}</h1>
        <p className="mt-1 text-xs leading-5 text-gtext-muted">{timeline.capability.description}</p>
      </div>

      <div className="flex items-center gap-1 rounded-glass-md border border-glassline bg-glass-2 p-1">
        {TABS.map(({ key, label, adminLabel, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-glass-pill px-3 text-xs transition-all duration-200',
              tab === key
                ? 'bg-gbg-raised text-gtext-primary shadow-glass-sm'
                : 'text-gtext-muted hover:bg-glass-3 hover:text-gtext-secondary',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {timeline.canManage && adminLabel ? adminLabel : label}
          </button>
        ))}
      </div>

      {tab === 'versions' && <VersionTimelinePanel timeline={timeline} />}
      {tab === 'changes' && (
        <PersonalChangesPanel capabilityId={capabilityId} currentUserId={currentUserId} />
      )}
      {tab === 'usage' && (
        <UsagePanel capabilityId={capabilityId} canManage={timeline.canManage} />
      )}
      {tab === 'insights' && (
        <InsightsPanel capabilityId={capabilityId} canManage={timeline.canManage} />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/capabilities"
      className="inline-flex items-center gap-1 text-xs text-gtext-muted transition-colors hover:text-gbrand-text"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      返回{nav.capabilities}
    </Link>
  );
}
