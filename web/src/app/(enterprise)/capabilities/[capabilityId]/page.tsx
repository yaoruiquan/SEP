'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileStack, ListTree, Sparkles } from 'lucide-react';
import { ExecutionDetailPanel } from '@/features/capability-iteration/execution-detail-panel';
import { UsagePanel } from '@/features/capability-iteration/usage-panel';
import { VersionTimelinePanel } from '@/features/capability-iteration/version-timeline-panel';
import { useVersionTimeline } from '@/features/capability-iteration/use-capability-iteration';
import { cn } from '@/lib/utils';

type Tab = 'versions' | 'usage' | 'executions';

const TABS: Array<{ key: Tab; label: string; icon: React.ElementType }> = [
  { key: 'versions', label: '版本', icon: ListTree },
  { key: 'usage', label: '使用', icon: Sparkles },
  { key: 'executions', label: '明细', icon: FileStack },
];

/**
 * 能力迭代详情。
 *
 * 三个 tab 对应会议决策 2 的三件事：改到第几版（版本）、多少人在用（使用）、
 * 输入输出是什么（明细）。「迭代建议」（T2.8 智能沉淀）留到后续，那需要新的
 * LLM 分析模块，不在本轮范围。
 */
export default function CapabilityIterationDetailPage() {
  const params = useParams<{ capabilityId: string }>();
  const capabilityId = params.capabilityId;
  const [tab, setTab] = useState<Tab>('versions');

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
        {TABS.map(({ key, label, icon: Icon }) => (
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
            {label}
          </button>
        ))}
      </div>

      {tab === 'versions' && <VersionTimelinePanel timeline={timeline} />}
      {tab === 'usage' && <UsagePanel capabilityId={capabilityId} />}
      {tab === 'executions' && (
        <ExecutionDetailPanel capabilityId={capabilityId} canManage={timeline.canManage} />
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
      返回能力迭代
    </Link>
  );
}
