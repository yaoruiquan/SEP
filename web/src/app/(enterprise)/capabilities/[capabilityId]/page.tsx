'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, GitCompare, ListTree, Sparkles, Users, CheckCircle2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InsightsPanel } from '@/features/capability-iteration/insights-panel';
import { PersonalChangesPanel } from '@/features/capability-iteration/personal-changes-panel';
import { UsagePanel } from '@/features/capability-iteration/usage-panel';
import { VersionTimelinePanel, formatDate } from '@/features/capability-iteration/version-timeline-panel';
import { useVersionTimeline, type VersionTimeline } from '@/features/capability-iteration/use-capability-iteration';
import { skillVersionLabel } from '@/features/capability-iteration/version-source';
import { useAuthStore } from '@/lib/auth-store';
import { nav } from '@/locales/zh-CN';
import styles from '@/features/capability-iteration/skill-detail.module.css';

const TABS = [
  { key: 'versions', label: '发布版本', icon: ListTree },
  { key: 'changes', label: '提交与审核', icon: GitCompare },
  { key: 'usage', label: '使用统计', icon: Users },
  { key: 'insights', label: '迭代建议', icon: Sparkles },
] as const;

export default function CapabilityIterationDetailPage() {
  const { capabilityId } = useParams<{ capabilityId: string }>();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [navigation, setNavigation] = useState(() => ({ query, location: new URLSearchParams(query) }));
  if (navigation.query !== query) setNavigation({ query, location: new URLSearchParams(query) });
  const location = navigation.query === query ? navigation.location : new URLSearchParams(query);
  const tab = TABS.find((item) => item.key === location.get('tab'))?.key ?? 'versions';
  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(location);
    for (const [key, value] of Object.entries(patch)) { if (value === null) next.delete(key); else next.set(key, value); }
    setNavigation({ query, location: next });
    window.history.pushState(null, '', `${window.location.pathname}?${next.toString()}`);
  };
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const { data: timeline, isLoading, isError, error, refetch } = useVersionTimeline(capabilityId);
  const width = 'mx-auto w-full max-w-[1120px]';
  if (isLoading) return <div className={`${width} space-y-4`}><div className="h-8 w-64 animate-pulse rounded-md bg-glass-2" /><div className="h-64 animate-pulse bg-glass-1" /></div>;
  if (isError || !timeline) return <div className={width}><BackLink /><p className="py-8 text-sm text-gdanger" role="alert">{error instanceof Error ? error.message : '能力详情加载失败'}</p><button onClick={() => void refetch()} className="text-xs text-gbrand-text">重试</button></div>;

  return <div className={`${width} ${styles.page} space-y-5 pb-8`}>
    <header><BackLink /><h1 className="mt-4 break-words text-xl font-semibold text-gtext-primary">{timeline.capability.name}</h1>
      <p className={`${styles.description} mt-2 break-words text-sm leading-6`}>{timeline.capability.description}</p></header>
    <CurrentVersionSummary timeline={timeline} />
    <Tabs value={tab} onValueChange={(value) => navigate({ tab: value })}>
      <TabsList aria-label="技能详情" className={`${styles.tabs} h-auto w-full justify-start overflow-x-auto`}>
        {TABS.map(({ key, label, icon: Icon }) => <TabsTrigger key={key} value={key}
          className={`${styles.tab} flex-1 gap-1.5 px-2 text-xs sm:flex-none sm:px-4`}>
          <Icon className="hidden h-3.5 w-3.5 shrink-0 sm:block" />{label}
          {key === 'changes' && Boolean(timeline.pendingTotal) && <span className={`${styles.count} tabular-nums`}>{timeline.pendingTotal}</span>}
        </TabsTrigger>)}
      </TabsList>
      <TabsContent value="versions" className="mt-5"><VersionTimelinePanel timeline={timeline} releaseId={location.get('release')} sourceFilter={location.get('source')} onNavigate={navigate} /></TabsContent>
      <TabsContent value="changes" className="mt-5"><PersonalChangesPanel capabilityId={capabilityId} currentUserId={currentUserId}
        initialStatus={location.get('status')} initialPage={Number(location.get('page')) || 1} submissionId={location.get('submission')} onNavigate={navigate} /></TabsContent>
      <TabsContent value="usage" className="mt-5"><UsagePanel capabilityId={capabilityId} canManage={timeline.canManage} /></TabsContent>
      <TabsContent value="insights" className="mt-5"><InsightsPanel capabilityId={capabilityId} canManage={timeline.canManage} /></TabsContent>
    </Tabs>
  </div>;
}

function CurrentVersionSummary({ timeline }: { timeline: VersionTimeline }) {
  const state = timeline.effectiveVersionState ?? (timeline.currentVersionId ? 'EXPLICIT' : 'NONE');
  const current = timeline.effectiveVersion ?? timeline.versions?.find((version) => version.id === timeline.currentVersionId);
  return <section aria-label="企业当前启用" className={`${styles.currentSummary} flex flex-wrap items-center justify-between gap-3`}>
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-2.5 text-gtext-secondary"><span className={styles.currentIcon}><CheckCircle2 className="h-4 w-4" /></span>企业当前启用</span>
      <span className="break-words text-sm font-semibold text-gtext-primary">{state === 'MIXED' ? '未设置统一启用版本' : current ? skillVersionLabel(current) : '暂无可用版本'}</span>
      {state === 'AUTOMATIC' && <span className="text-gtext-muted">自动使用</span>}
      {state === 'EXPLICIT' && timeline.selectedAt && <span className="text-gtext-muted">启用于 {formatDate(timeline.selectedAt)}</span>}
    </div>
    {state === 'MIXED' && <details className="w-full text-xs"><summary className="cursor-pointer text-gbrand-text">按员工查看</summary>
      <ul className="mt-2 divide-y divide-glassline">{timeline.subscriptions.map((subscription) => {
        const version = timeline.versions.find((item) => item.id === subscription.effectiveVersionId);
        return <li key={subscription.subscriptionId} className="flex flex-wrap justify-between gap-2 py-2">
          <span className="break-words text-gtext-secondary">{subscription.employeeName}</span>
          <span className="text-gtext-muted">{version ? skillVersionLabel(version) : subscription.effectiveVersionId ? '版本详情不可查看' : '暂无可用版本'}</span>
        </li>;
      })}</ul></details>}
  </section>;
}

function BackLink() {
  return <Link href="/capabilities" className="inline-flex items-center gap-1 text-xs text-gtext-muted transition-colors hover:text-gbrand-text"><ArrowLeft className="h-3.5 w-3.5" />返回{nav.capabilities}</Link>;
}
