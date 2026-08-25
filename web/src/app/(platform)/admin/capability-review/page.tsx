'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight, Bot, CheckCircle2, Clock3, FileCode2, Filter, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import {
  useUnifiedCapabilityReviewQueue,
  type UnifiedReviewItem,
  type UnifiedReviewKind,
} from '@/features/contribution/use-contribution-admin';

const filters: Array<{ value: UnifiedReviewKind; label: string }> = [
  { value: 'ALL', label: '全部待审' },
  { value: 'CAPABILITY', label: '能力投稿' },
  { value: 'SKILL_VERSION', label: 'Skill 版本' },
];

export default function CapabilityReviewPage() {
  const [kind, setKind] = useState<UnifiedReviewKind>('ALL');
  const [search, setSearch] = useState('');
  const queue = useUnifiedCapabilityReviewQueue(kind);
  const items = queue.data?.items ?? [];
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      [item.name, item.capabilityName, item.enterprise?.name, item.submittedBy.name, item.submittedBy.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [items, search]);

  const capabilityCount = items.filter((item) => item.kind === 'CAPABILITY').length;
  const versionCount = items.filter((item) => item.kind === 'SKILL_VERSION').length;

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col overflow-hidden">
      <header className="shrink-0 border-b border-glassline px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gbrand-text">
              <CheckCircle2 className="h-4 w-4" /> Capability governance
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-gtext-primary">能力审核</h1>
            <p className="mt-1 max-w-2xl text-sm text-gtext-muted">
              在同一条队列里处理能力公开申请和 Skill 版本上架申请。企业私有内容不会进入平台审核。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric label="待处理" value={queue.data?.total ?? 0} tone="warning" />
            <Metric label="能力投稿" value={capabilityCount} tone="brand" />
            <Metric label="Skill 版本" value={versionCount} tone="info" />
          </div>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col px-6 py-5">
        <div className="flex shrink-0 flex-col gap-3 border-b border-glassline pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 overflow-x-auto">
            <Filter className="h-4 w-4 shrink-0 text-gtext-muted" />
            {filters.map((filter) => (
              <Button
                key={filter.value}
                size="sm"
                variant={kind === filter.value ? 'glass-primary' : 'glass'}
                onClick={() => setKind(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索能力、企业或提交人"
              className="h-9 w-full rounded-md border border-glassline bg-glass-1 pl-9 pr-3 text-sm text-gtext-primary outline-none placeholder:text-gtext-muted focus:border-glassline-brand"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pt-4 scroll-thin">
          {queue.isLoading ? (
            <CenteredSpinner label="加载统一审核队列..." />
          ) : queue.isError ? (
            <EmptyState title="审核队列加载失败" description="请检查平台管理员权限或稍后重试。" />
          ) : filtered.length ? (
            <div className="overflow-hidden rounded-md border border-glassline bg-glass-1">
              <div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(130px,0.8fr)_minmax(120px,0.7fr)_120px_36px] gap-4 border-b border-glassline bg-glass-2 px-4 py-3 text-xs font-medium text-gtext-muted md:grid">
                <span>待审核内容</span><span>来源</span><span>提交人</span><span>提交时间</span><span />
              </div>
              {filtered.map((item) => <ReviewRow key={`${item.kind}-${item.id}`} item={item} />)}
            </div>
          ) : (
            <EmptyState icon={<CheckCircle2 className="h-10 w-10" />} title="当前没有待处理项" description="企业授权并提交公开申请后，内容会出现在这里。" />
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'warning' | 'brand' | 'info' }) {
  const toneClass = {
    warning: 'border-gwarning/25 bg-gwarning/10 text-gwarning',
    brand: 'border-gbrand-ring bg-gbrand/10 text-gbrand-text',
    info: 'border-ginfo/25 bg-ginfo/10 text-ginfo',
  }[tone];
  return <div className={cn('min-w-[92px] rounded-md border px-3 py-2', toneClass)}><p className="text-[11px] opacity-80">{label}</p><p className="mt-0.5 text-xl font-semibold">{value}</p></div>;
}

function ReviewRow({ item }: { item: UnifiedReviewItem }) {
  const href = item.kind === 'CAPABILITY' ? `/admin/contributions/${item.id}` : `/admin/skills/${item.id}`;
  const isSkill = item.kind === 'SKILL_VERSION';
  return (
    <Link href={href} className="group grid gap-3 border-b border-glassline px-4 py-4 transition-colors last:border-b-0 hover:bg-glass-2 md:grid-cols-[minmax(0,1.7fr)_minmax(130px,0.8fr)_minmax(120px,0.7fr)_120px_36px] md:items-center md:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-md border', isSkill ? 'border-gbrand-ring bg-gbrand/15 text-gbrand-text' : 'border-ginfo/30 bg-ginfo/10 text-ginfo')}>
          {isSkill ? <FileCode2 className="h-4 w-4" /> : item.type === 'AGENT' ? <Bot className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-gtext-primary">{item.name}</span><Badge variant={isSkill ? 'glass-info' : 'glass-warning'}>{isSkill ? 'Skill 版本' : '能力投稿'}</Badge></span>
          <span className="mt-1 block truncate text-xs text-gtext-muted">{isSkill ? item.capabilityName : item.type} · {item.enterprise?.name || '个人贡献'}</span>
        </span>
      </div>
      <div className="text-xs text-gtext-secondary md:block"><span className="text-gtext-muted md:hidden">来源：</span>{item.enterprise?.name || '个人贡献'}</div>
      <div className="truncate text-xs text-gtext-secondary"><span className="text-gtext-muted md:hidden">提交人：</span>{item.submittedBy.name || item.submittedBy.email}</div>
      <div className="flex items-center gap-1 text-xs text-gtext-muted"><Clock3 className="h-3.5 w-3.5" />{formatSubmittedAt(item.submittedAt)}</div>
      <ArrowUpRight className="hidden h-4 w-4 text-gtext-muted transition-colors group-hover:text-gbrand-text md:block" />
    </Link>
  );
}

function formatSubmittedAt(value: string | null) {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未记录' : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
