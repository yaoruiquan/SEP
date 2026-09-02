'use client';

import { cn } from '@/lib/utils';
import type { ContributionCapability } from '@/lib/types';
import { boardLane, type PipelineModel, type StageKey } from '../pipeline-model';
import { ContributionLaneCard } from './contribution-asset-card';

export interface LaneEntry {
  item: ContributionCapability;
  model: PipelineModel;
}

const LANE_TITLE: Record<StageKey, string> = {
  draft: '草稿 · 待提交',
  validate: '自动校验',
  enterprise: '企业审核中',
  authorize: '投稿与授权',
  platform: '平台审核中',
  market: '已收录为公共能力',
};

/**
 * 阶段轨道看板。
 *
 * 按能力当前所处的流程节点横向分列。列的集合取自实际数据里出现过的最长路径
 * （企业路径 6 列 / 个人路径 4 列），避免为不存在的环节留空列。
 */
export function ContributionLaneBoard({
  entries,
  onOpen,
}: {
  entries: LaneEntry[];
  onOpen: (id: string) => void;
}) {
  const laneKeys = resolveLaneKeys(entries);
  const grouped = new Map<StageKey, LaneEntry[]>(laneKeys.map((key) => [key, []]));
  for (const entry of entries) {
    grouped.get(boardLane(entry.model))?.push(entry);
  }

  return (
    <div className="overflow-x-auto scroll-thin pb-2">
      <div className="flex min-w-full gap-2.5">
        {laneKeys.map((key) => {
          const lane = grouped.get(key) ?? [];
          const actionable = lane.some((entry) => entry.model.ballInCourt);
          return (
            <section
              key={key}
              className={cn(
                // flex-1 + min-w：6 条轨道在常规桌面宽度下能一屏放下，
                // 窄屏时收缩到 min-w 后才横向滚动。固定宽度会让最右侧的轨道被裁掉。
                'flex min-h-[176px] min-w-[168px] flex-1 flex-col rounded-glass-lg border bg-glass-1/60 p-2',
                actionable ? 'border-glassline-brand' : 'border-glassline',
              )}
              aria-label={`${LANE_TITLE[key]} ${lane.length} 项`}
            >
              <header className="flex items-center justify-between gap-2 px-1 pb-2.5">
                <h3 className="truncate text-xs font-semibold text-gtext-secondary">{LANE_TITLE[key]}</h3>
                <span
                  className={cn(
                    'rounded-glass-pill border px-1.5 py-0.5 text-[10px] tabular-nums',
                    lane.length
                      ? 'border-glassline bg-glass-2 text-gtext-secondary'
                      : 'border-transparent text-gtext-muted',
                  )}
                >
                  {lane.length}
                </span>
              </header>
              <div className="flex flex-1 flex-col gap-2">
                {lane.length ? (
                  lane.map((entry) => (
                    <ContributionLaneCard
                      key={entry.item.id}
                      item={entry.item}
                      model={entry.model}
                      onOpen={() => onOpen(entry.item.id)}
                    />
                  ))
                ) : (
                  <div className="grid flex-1 place-items-start px-1 pt-1">
                    <p className="text-[11px] text-gtext-muted">暂无能力</p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const ENTERPRISE_LANES: StageKey[] = ['draft', 'validate', 'enterprise', 'authorize', 'platform', 'market'];
const PERSONAL_LANES: StageKey[] = ['draft', 'validate', 'platform', 'market'];

function resolveLaneKeys(entries: LaneEntry[]): StageKey[] {
  const useEnterprise = entries.some((entry) => entry.model.total === ENTERPRISE_LANES.length);
  return useEnterprise ? ENTERPRISE_LANES : PERSONAL_LANES;
}
