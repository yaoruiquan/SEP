'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, LayoutGrid, List, Plus, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { currentContributionState } from './contribution-status';
import { buildPipeline } from './pipeline-model';
import { ContributionAssetCard } from './components/contribution-asset-card';
import { ContributionLaneBoard, type LaneEntry } from './components/contribution-lane-board';
import { OverviewSummaryBar } from './components/overview-summary-bar';
import { ContributionCreateDialog } from './contribution-create-dialog';
import { ContributionDetail } from './contribution-detail';
import { useContributionOverview, useMyContributions } from './use-contributions';

type TypeFilter = 'ALL' | 'AGENT' | 'SKILL' | 'RPA' | 'AI_APP';
type StageFilter = 'all' | 'mine' | 'draft' | 'review' | 'public' | 'rejected';
type ViewMode = 'list' | 'board';

const VIEW_STORAGE_KEY = 'sep.contribution.view';

export function ContributionDashboard() {
  const overview = useContributionOverview();
  const contributions = useMyContributions();
  const hasEnterprise = Boolean(useAuthStore((s) => s.enterprise));
  const isEnterpriseAdmin = useAuthStore((s) => s.roleInEnterprise) === 'ENTERPRISE_ADMIN';
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'list' || stored === 'board') setView(stored);
  }, []);

  const setViewMode = (next: ViewMode) => {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  // 列表与详情共用 buildPipeline，进度只有一个来源
  const entries = useMemo<LaneEntry[]>(
    () =>
      (contributions.data ?? []).map((item) => ({
        item,
        model: buildPipeline(item, {
          hasEnterprise,
          isContributor: currentUserId === item.contributor.id,
          isEnterpriseAdmin,
        }),
      })),
    [contributions.data, currentUserId, hasEnterprise, isEnterpriseAdmin],
  );

  const actionableCount = useMemo(() => entries.filter((entry) => entry.model.ballInCourt).length, [entries]);

  const visible = useMemo(
    () => entries.filter((entry) => matchesFilters(entry, { query, typeFilter, stageFilter })),
    [entries, query, stageFilter, typeFilter],
  );

  useEffect(() => {
    if (selectedId && !visible.some((entry) => entry.item.id === selectedId)) setSelectedId(null);
  }, [visible, selectedId]);

  if (overview.isLoading || contributions.isLoading) return <DashboardLoading />;
  if (overview.isError || contributions.isError || !overview.data) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState title="贡献工作台加载失败" description="请刷新页面后重试。" />
      </div>
    );
  }

  const resetFilters = () => {
    setQuery('');
    setTypeFilter('ALL');
    setStageFilter('all');
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gbg-canvas">
      <header className="shrink-0 border-b border-glassline bg-gbg-deep/45 px-5 py-4 backdrop-blur-glass-sm xl:px-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-gbrand-text">
              <span className="grid h-5 w-5 place-items-center rounded-glass-md border border-glassline-brand bg-gbrand/10">
                <Sparkles className="h-3 w-3" />
              </span>
              CAPABILITY OPERATIONS
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold tracking-normal text-gtext-primary">能力贡献中心</h1>
              <p className="text-sm text-gtext-muted">把可复用的工作方法，发布为组织资产</p>
            </div>
          </div>
          <Button variant="glass-primary" className="self-start xl:self-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            创建能力
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden bg-gbg-canvas">
        {selectedId ? (
          <ContributionDetail id={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="h-full overflow-y-auto scroll-thin px-5 py-5 xl:px-10 xl:py-6">
            <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
              <OverviewSummaryBar
                overview={overview.data}
                actionableCount={actionableCount}
                onFocusActionable={() => setStageFilter('mine')}
              />
              <FilterToolbar
                query={query}
                typeFilter={typeFilter}
                stageFilter={stageFilter}
                view={view}
                actionableCount={actionableCount}
                onQueryChange={setQuery}
                onTypeFilterChange={setTypeFilter}
                onStageFilterChange={setStageFilter}
                onViewChange={setViewMode}
              />
              {entries.length === 0 ? (
                <FirstCapabilityPrompt onCreate={() => setCreateOpen(true)} />
              ) : visible.length === 0 ? (
                <NoMatchState onReset={resetFilters} />
              ) : view === 'board' ? (
                <ContributionLaneBoard entries={visible} onOpen={setSelectedId} />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {visible.map((entry) => (
                    <ContributionAssetCard
                      key={entry.item.id}
                      item={entry.item}
                      model={entry.model}
                      onOpen={() => setSelectedId(entry.item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <ContributionCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'ALL', label: '全部类型' },
  { value: 'SKILL', label: 'Skill' },
  { value: 'AGENT', label: 'Agent' },
  { value: 'RPA', label: 'RPA' },
  { value: 'AI_APP', label: 'AI App' },
];

const STAGE_FILTERS: Array<{ value: StageFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'mine', label: '待我处理' },
  { value: 'draft', label: '草稿' },
  { value: 'review', label: '审核中' },
  { value: 'public', label: '已公开' },
  { value: 'rejected', label: '已驳回' },
];

function matchesFilters(
  entry: LaneEntry,
  filters: { query: string; typeFilter: TypeFilter; stageFilter: StageFilter },
) {
  const { item, model } = entry;
  const keyword = filters.query.trim().toLowerCase();
  const state = currentContributionState(item);

  const matchedKeyword =
    !keyword ||
    [item.name, item.description, item.type, item.enterprise?.name ?? '', ...(item.industry ?? []), ...(item.position ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  const matchedType = filters.typeFilter === 'ALL' || item.type === filters.typeFilter;
  const matchedStage =
    filters.stageFilter === 'all' ||
    (filters.stageFilter === 'mine' && model.ballInCourt) ||
    (filters.stageFilter === 'draft' && state.label === '草稿') ||
    (filters.stageFilter === 'review' && state.tone === 'warning') ||
    (filters.stageFilter === 'public' && item.visibility === 'MARKET_PUBLIC') ||
    (filters.stageFilter === 'rejected' && state.tone === 'danger');

  return matchedKeyword && matchedType && matchedStage;
}

function FilterToolbar({
  query,
  typeFilter,
  stageFilter,
  view,
  actionableCount,
  onQueryChange,
  onTypeFilterChange,
  onStageFilterChange,
  onViewChange,
}: {
  query: string;
  typeFilter: TypeFilter;
  stageFilter: StageFilter;
  view: ViewMode;
  actionableCount: number;
  onQueryChange: (value: string) => void;
  onTypeFilterChange: (value: TypeFilter) => void;
  onStageFilterChange: (value: StageFilter) => void;
  onViewChange: (value: ViewMode) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-glass-lg border border-glassline bg-glass-1 p-3 shadow-glass-sm xl:flex-row xl:items-center xl:justify-between">
      <label className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-glass-md border border-glassline bg-glass-2 px-3 transition-colors duration-200 focus-within:border-glassline-brand">
        <Search className="h-3.5 w-3.5 shrink-0 text-gtext-muted" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索能力名称、说明、行业或岗位"
          className="min-w-0 flex-1 bg-transparent text-sm text-gtext-primary outline-none placeholder:text-gtext-muted"
        />
      </label>
      <div className="flex items-center gap-2 overflow-x-auto scroll-thin">
        <SegmentedGroup>
          {TYPE_FILTERS.map((filter) => (
            <SegmentedButton
              key={filter.value}
              active={typeFilter === filter.value}
              onClick={() => onTypeFilterChange(filter.value)}
            >
              {filter.label}
            </SegmentedButton>
          ))}
        </SegmentedGroup>
        <SegmentedGroup>
          {STAGE_FILTERS.map((filter) => (
            <SegmentedButton
              key={filter.value}
              active={stageFilter === filter.value}
              onClick={() => onStageFilterChange(filter.value)}
              badge={filter.value === 'mine' && actionableCount > 0 ? actionableCount : undefined}
            >
              {filter.label}
            </SegmentedButton>
          ))}
        </SegmentedGroup>
        <SegmentedGroup>
          <SegmentedButton active={view === 'list'} onClick={() => onViewChange('list')} aria-label="列表视图">
            <List className="h-3.5 w-3.5" />
          </SegmentedButton>
          <SegmentedButton active={view === 'board'} onClick={() => onViewChange('board')} aria-label="轨道看板">
            <LayoutGrid className="h-3.5 w-3.5" />
          </SegmentedButton>
        </SegmentedGroup>
      </div>
    </div>
  );
}

function SegmentedGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-glass-md border border-glassline bg-glass-2 p-1">
      {children}
    </div>
  );
}

function SegmentedButton({
  active,
  onClick,
  badge,
  children,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
} & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-glass-pill px-2.5 text-xs transition-all duration-200',
        active
          ? 'bg-gbg-raised text-gtext-primary shadow-glass-sm'
          : 'text-gtext-muted hover:bg-glass-3 hover:text-gtext-secondary',
      )}
      {...rest}
    >
      {children}
      {badge !== undefined && (
        <span className="rounded-glass-pill bg-gbrand/15 px-1.5 text-[10px] font-medium tabular-nums text-gbrand-text">
          {badge}
        </span>
      )}
    </button>
  );
}

function NoMatchState({ onReset }: { onReset: () => void }) {
  return (
    <div className="grid min-h-52 place-items-center rounded-glass-lg border border-glassline bg-glass-1 text-center shadow-glass-sm">
      <div>
        <Search className="mx-auto h-5 w-5 text-gtext-muted" />
        <p className="mt-2 text-sm text-gtext-secondary">没有匹配的能力</p>
        <button type="button" className="mt-1 text-xs text-gbrand-text hover:underline" onClick={onReset}>
          清除筛选
        </button>
      </div>
    </div>
  );
}

function FirstCapabilityPrompt({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid place-items-center rounded-glass-lg border border-dashed border-glassline bg-glass-1/50 px-6 py-14 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-glass-lg border border-glassline-brand bg-gbrand/10 text-gbrand-text">
          <Sparkles className="h-6 w-6" />
        </span>
        <h2 className="mt-5 text-lg font-semibold text-gtext-primary">从第一项能力开始</h2>
        <p className="mt-2 text-sm leading-6 text-gtext-secondary">
          创建后它会先进入校验与审核管线，每一步由谁处理、进行到哪里都会记录在这里。
        </p>
        <Button variant="glass-primary" className="mt-5" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          创建能力
        </Button>
      </div>
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-3 text-sm text-gtext-secondary">
        <Clock3 className="h-4 w-4 animate-spin text-gbrand-text" />
        正在同步能力资产...
      </div>
    </div>
  );
}
