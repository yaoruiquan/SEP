'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CircleDotDashed,
  Clock3,
  Coins,
  Filter,
  Layers3,
  Plus,
  Search,
  Sparkles,
  Store,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import type { ContributionCapability } from '@/lib/types';
import { currentContributionState, toneClasses, TYPE_META } from './contribution-status';
import { ContributionCreateDialog } from './contribution-create-dialog';
import { ContributionDetail } from './contribution-detail';
import { useContributionOverview, useMyContributions } from './use-contributions';

type FilterKey = 'all' | 'active' | 'public';

export function ContributionDashboard() {
  const overview = useContributionOverview();
  const contributions = useMyContributions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [createOpen, setCreateOpen] = useState(false);

  const items = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (contributions.data ?? []).filter((item) => {
      const state = currentContributionState(item);
      const matched = !keyword || [item.name, item.description, item.type].join(' ').toLowerCase().includes(keyword);
      const matchedFilter = filter === 'all'
        || (filter === 'active' && state.tone === 'warning')
        || (filter === 'public' && item.visibility === 'MARKET_PUBLIC');
      return matched && matchedFilter;
    });
  }, [contributions.data, filter, query]);

  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  if (overview.isLoading || contributions.isLoading) return <DashboardLoading />;
  if (overview.isError || contributions.isError || !overview.data) {
    return <div className="grid h-full place-items-center"><EmptyState title="贡献工作台加载失败" description="请刷新页面后重试。" /></div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gbg-canvas">
      <header className="shrink-0 border-b border-glassline bg-gbg-deep/45 px-5 py-4 backdrop-blur-glass-sm xl:px-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-gbrand-text">
              <span className="grid h-5 w-5 place-items-center border border-glassline-brand bg-gbrand/15"><Sparkles className="h-3 w-3" /></span>
              CAPABILITY OPERATIONS
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-normal text-gtext-primary">能力贡献中心</h1>
              <p className="text-sm text-gtext-muted">把可复用的工作方法，发布为组织资产</p>
            </div>
          </div>
          <Button variant="glass-primary" className="self-start xl:self-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />创建能力
          </Button>
        </div>
      </header>

      <section className="shrink-0 border-b border-glassline bg-gbg-deep/25 px-5 py-3 xl:px-7">
        <div className="grid grid-cols-2 divide-x divide-glassline border border-glassline bg-glass-1 md:grid-cols-4">
          <Metric icon={Layers3} label="能力资产" value={overview.data.capabilityCount} note="当前工作区" />
          <Metric icon={CircleDotDashed} label="发布处理中" value={overview.data.pendingEnterpriseReview + overview.data.pendingPlatformAuthorization} note="等待下一步" tone="warning" />
          <Metric icon={Store} label="市场可见" value={overview.data.publicCapabilityCount} note="已完成上架" tone="success" />
          <Metric icon={Coins} label="贡献积分" value={overview.data.pendingRewardPoints} note="待结算奖励" tone="brand" />
        </div>
      </section>

      <main className="min-h-0 flex-1 overflow-hidden bg-gbg-canvas">
        {selectedId ? <ContributionDetail id={selectedId} onBack={() => setSelectedId(null)} /> : <OverviewCanvas items={items} total={contributions.data?.length ?? 0} query={query} filter={filter} onQueryChange={setQuery} onFilterChange={setFilter} onOpen={setSelectedId} onCreate={() => setCreateOpen(true)} usageCount={overview.data.usageCount} />}
      </main>
      <ContributionCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function Metric({ icon: Icon, label, value, note, tone = 'muted' }: { icon: React.ElementType; label: string; value: number; note: string; tone?: 'muted' | 'warning' | 'success' | 'brand' }) {
  const color = { muted: 'text-gtext-muted', warning: 'text-gwarning', success: 'text-gsuccess', brand: 'text-gbrand-text' }[tone];
  return <div className="flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4"><span className={cn('grid h-8 w-8 shrink-0 place-items-center border border-glassline bg-glass-2', color)}><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="text-lg font-semibold leading-none text-gtext-primary">{value}</p><p className="mt-1 text-xs text-gtext-secondary">{label}</p><p className="mt-0.5 truncate text-[11px] text-gtext-muted">{note}</p></div></div>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn('h-7 text-xs transition-colors', active ? 'bg-gbg-raised text-gtext-primary shadow-glass-sm' : 'text-gtext-muted hover:text-gtext-secondary')}>{children}</button>;
}

function OverviewCanvas({ items, total, query, filter, onQueryChange, onFilterChange, onOpen, onCreate, usageCount }: { items: ContributionCapability[]; total: number; query: string; filter: FilterKey; onQueryChange: (value: string) => void; onFilterChange: (value: FilterKey) => void; onOpen: (id: string) => void; onCreate: () => void; usageCount: number }) {
  return <div className="h-full overflow-y-auto scroll-thin px-5 py-6 xl:px-10 xl:py-8"><div className="mx-auto max-w-[1320px]">
    <div className="flex flex-col justify-between gap-4 border-b border-glassline pb-5 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-gtext-muted">Workspace inventory</p><h2 className="mt-1 text-lg font-semibold text-gtext-primary">能力资产总览</h2><p className="mt-1 text-sm text-gtext-secondary">先选择一项能力，再进入它的发布工作区。</p></div><div className="flex items-center gap-2 text-xs text-gtext-muted"><span className="h-1.5 w-1.5 bg-gsuccess" />已接入 {usageCount} 次调用</div></div>
    <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><label className="flex h-10 max-w-md flex-1 items-center gap-2 border border-glassline bg-glass-1 px-3 focus-within:border-glassline-brand"><Search className="h-4 w-4 text-gtext-muted" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索能力名称、类型或归属" className="min-w-0 flex-1 bg-transparent text-sm text-gtext-primary outline-none placeholder:text-gtext-muted" /></label><div className="flex items-center gap-1 border border-glassline bg-glass-1 p-1"><Filter className="mx-2 h-3.5 w-3.5 text-gtext-muted" /><FilterButton active={filter === 'all'} onClick={() => onFilterChange('all')}>全部</FilterButton><FilterButton active={filter === 'active'} onClick={() => onFilterChange('active')}>进行中</FilterButton><FilterButton active={filter === 'public'} onClick={() => onFilterChange('public')}>已公开</FilterButton></div></div>
    <div className="mt-5 border-y border-glassline"><div className="hidden grid-cols-[minmax(280px,1.4fr)_160px_180px_90px_120px] gap-4 bg-glass-1 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gtext-muted md:grid"><span>能力资产</span><span>归属</span><span>当前阶段</span><span>版本</span><span className="text-right">进度</span></div>{items.length ? items.map((item) => <AssetRow key={item.id} item={item} onOpen={() => onOpen(item.id)} />) : <div className="grid min-h-52 place-items-center text-center"><div><Search className="mx-auto h-5 w-5 text-gtext-muted" /><p className="mt-2 text-sm text-gtext-secondary">没有匹配的能力</p><button type="button" className="mt-1 text-xs text-gbrand-text" onClick={() => { onQueryChange(''); onFilterChange('all'); }}>清除筛选</button></div></div>}</div>
    <div className="mt-7 flex items-center justify-between border border-dashed border-glassline bg-glass-1/50 px-4 py-4"><div><p className="text-sm font-medium text-gtext-primary">还有可复用的方法没有沉淀？</p><p className="mt-1 text-xs text-gtext-muted">创建草稿后，系统会自动校验并进入对应审核管线。</p></div><Button variant="glass" size="sm" onClick={onCreate}><Plus className="h-4 w-4" />创建能力</Button></div>
  </div></div>;
}

function AssetRow({ item, onOpen }: { item: ContributionCapability; onOpen: () => void }) {
  const state = currentContributionState(item);
  const progress = state.tone === 'success' ? 100 : state.tone === 'warning' ? 54 : state.tone === 'danger' ? 34 : 16;
  return <button type="button" onClick={onOpen} className="group grid w-full gap-3 border-t border-glassline px-4 py-4 text-left transition-colors hover:bg-glass-1 md:grid-cols-[minmax(280px,1.4fr)_160px_180px_90px_120px] md:items-center md:gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><span className="h-2 w-2 shrink-0 bg-gbrand" /><p className="truncate text-sm font-semibold text-gtext-primary">{item.name}</p><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-gtext-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gbrand-text" /></div><p className="mt-1 line-clamp-1 pl-4 text-xs text-gtext-muted">{item.description}</p></div><div className="pl-4 text-xs text-gtext-secondary md:pl-0">{item.enterprise?.name ?? '个人贡献'}</div><div className={cn('pl-4 text-xs md:pl-0', state.tone === 'success' ? 'text-gsuccess' : state.tone === 'warning' ? 'text-gwarning' : state.tone === 'danger' ? 'text-gdanger' : 'text-gtext-muted')}>{state.label}</div><div className="pl-4 text-xs text-gtext-secondary md:pl-0">v{item._count.skillVersions}</div><div className="flex items-center gap-2 pl-4 md:pl-0"><div className="h-1.5 flex-1 bg-glass-3"><span className={cn('block h-full', state.tone === 'success' ? 'bg-gsuccess' : state.tone === 'warning' ? 'bg-gwarning' : state.tone === 'danger' ? 'bg-gdanger' : 'bg-gtext-muted')} style={{ width: `${progress}%` }} /></div><span className="w-8 text-right text-[11px] text-gtext-muted">{progress}%</span></div></button>;
}

function CapabilityRow({ item, selected, onClick }: { item: ContributionCapability; selected: boolean; onClick: () => void }) {
  const state = currentContributionState(item);
  const type = TYPE_META[item.type];
  const progress = state.tone === 'success' ? 100 : state.tone === 'warning' ? 54 : state.tone === 'danger' ? 34 : 16;
  return <button type="button" onClick={onClick} className={cn('group mb-1 w-full border-l-2 p-3 text-left transition-all', selected ? 'border-l-gbrand bg-glass-2 shadow-glass-sm' : 'border-l-transparent hover:border-l-glassline-brand hover:bg-glass-1')}>
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-gtext-primary">{item.name}</p><p className="mt-1 truncate text-xs text-gtext-muted">{type.label} · {item.enterprise?.name ?? '个人贡献'}</p></div><ArrowUpRight className={cn('h-4 w-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5', selected ? 'text-gbrand-text' : 'text-gtext-muted')} /></div>
    <div className="mt-3 flex items-center justify-between gap-3"><span className={cn('text-xs', state.tone === 'success' ? 'text-gsuccess' : state.tone === 'warning' ? 'text-gwarning' : state.tone === 'danger' ? 'text-gdanger' : 'text-gtext-muted')}>{state.label}</span><span className="text-[11px] text-gtext-muted">v{item._count.skillVersions}</span></div>
    <div className="mt-2 h-1 overflow-hidden bg-glass-3"><span className={cn('block h-full transition-all', state.tone === 'success' ? 'bg-gsuccess' : state.tone === 'warning' ? 'bg-gwarning' : state.tone === 'danger' ? 'bg-gdanger' : 'bg-gtext-muted')} style={{ width: `${progress}%` }} /></div>
  </button>;
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return <div className="grid h-full place-items-center p-8"><div className="max-w-sm text-center"><span className="mx-auto grid h-14 w-14 place-items-center border border-glassline-brand bg-gbrand/10 text-gbrand-text"><BriefcaseBusiness className="h-6 w-6" /></span><h2 className="mt-5 text-lg font-semibold text-gtext-primary">从第一项能力开始</h2><p className="mt-2 text-sm leading-6 text-gtext-secondary">创建后，它会先进入校验与企业审核管线；所有进度都会在这里沉淀。</p><Button variant="glass-primary" className="mt-5" onClick={onCreate}><Plus className="h-4 w-4" />创建能力</Button></div></div>;
}

function DashboardLoading() {
  return <div className="grid h-full place-items-center"><div className="flex items-center gap-3 text-sm text-gtext-secondary"><Clock3 className="h-4 w-4 animate-spin text-gbrand-text" />正在同步能力资产...</div></div>;
}
