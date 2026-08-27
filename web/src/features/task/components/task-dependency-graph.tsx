'use client';

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GitBranch, LayoutGrid, Sparkles, FileOutput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildTaskFlowStages } from '../task-flow';
import type { TaskPlan, TaskPlanStep } from '../task-orchestration';
import { narrateStep } from '../task-step-state';
import { CapabilityTag, EmployeeBadge, TONE_CHIP } from './employee-badge';

export interface GraphLayout {
  nodes: Record<string, { x: number; y: number }>;
  endpoints?: Partial<Record<'input' | 'output', { x: number; y: number }>>;
}

const NODE_W = 208;
const NODE_H = 96;
const COL_GAP = 252;
const ROW_GAP = 120;
const ORIGIN_X = 232;
const ORIGIN_Y = 28;

/**
 * 依赖深度自动布局。
 *
 * 重构前节点位置是 `250 + (index % 3) * 245` —— 3 列固定网格，和依赖关系完全无关，
 * 所以连线会斜穿画布。这里用 buildTaskFlowStages() 按 dependsOn 深度分列：
 * 同一深度的步骤排在同一列，连线永远是从左到右的短线。
 *
 * 自动布局只提供**初始位置**；用户拖过的节点保存在 layout.nodes 里并优先生效，
 * 「重新排列」把 layout 清空回到自动布局。
 */
export function autoLayout(steps: TaskPlanStep[]): Record<string, { x: number; y: number }> {
  // buildTaskFlowStages 按数组顺序累积深度，依赖必须先于被依赖者出现才算得对，
  // 所以先按 order 排（connectSteps 保证依赖只指向更小的 order）。
  const ordered = [...steps].sort((left, right) => left.order - right.order);
  const stages = buildTaskFlowStages(ordered);
  const result: Record<string, { x: number; y: number }> = {};
  for (const [column, stage] of stages.entries()) {
    for (const [row, step] of stage.steps.entries()) {
      result[step.id] = { x: ORIGIN_X + column * COL_GAP, y: ORIGIN_Y + row * ROW_GAP };
    }
  }
  return result;
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const sx = from.x + NODE_W;
  const sy = from.y + NODE_H / 2;
  const tx = to.x;
  const ty = to.y + NODE_H / 2;
  const bend = Math.max(28, Math.min(90, (tx - sx) / 2));
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
}

export interface TaskDependencyGraphProps {
  plan: TaskPlan;
  layout: GraphLayout | null;
  running: boolean;
  pausedStepIds: string[];
  selectedStepId?: string;
  onLayoutChange: (layout: GraphLayout) => void;
  onResetLayout: () => void;
  onSelectStep: (step: TaskPlanStep) => void;
  onConnectSteps: (sourceId: string, targetId: string) => void;
  onViewOutput: () => void;
}

export function TaskDependencyGraph({
  plan,
  layout,
  running,
  pausedStepIds,
  selectedStepId,
  onLayoutChange,
  onResetLayout,
  onSelectStep,
  onConnectSteps,
  onViewOutput,
}: TaskDependencyGraphProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | undefined>(undefined);
  const didDragRef = useRef(false);
  const [connectingFrom, setConnectingFrom] = useState<string>();
  const [pointer, setPointer] = useState<{ x: number; y: number }>();

  const ordered = useMemo(() => [...plan.steps].sort((l, r) => l.order - r.order), [plan.steps]);
  const auto = useMemo(() => autoLayout(ordered), [ordered]);
  const positions = useMemo(
    () => Object.fromEntries(ordered.map((step) => [step.id, layout?.nodes?.[step.id] ?? auto[step.id] ?? { x: ORIGIN_X, y: ORIGIN_Y }])),
    [auto, layout, ordered],
  );

  const dependentIds = new Set(ordered.flatMap((step) => step.dependsOn));
  const roots = ordered.filter((step) => step.dependsOn.length === 0);
  const leaves = ordered.filter((step) => !dependentIds.has(step.id));

  const maxX = Math.max(...Object.values(positions).map((p) => p.x), ORIGIN_X) + NODE_W;
  const nodeMaxY = Math.max(...Object.values(positions).map((p) => p.y), ORIGIN_Y) + NODE_H;

  // 端点对齐到它实际连的那些节点行，而不是画布垂直中线 ——
  // 否则连线会从画布中间往上斜甩到节点行，看起来像没接上。
  const averageY = (steps: TaskPlanStep[]) => {
    const ys = steps.map((step) => positions[step.id]?.y).filter((y): y is number => typeof y === 'number');
    return ys.length > 0 ? Math.round(ys.reduce((sum, y) => sum + y, 0) / ys.length) : ORIGIN_Y;
  };
  const inputPos = layout?.endpoints?.input ?? { x: 24, y: averageY(roots) };
  const outputPos = layout?.endpoints?.output ?? { x: maxX + 44, y: averageY(leaves) };

  const width = Math.max(880, outputPos.x + NODE_W + 24);
  const height = Math.max(300, Math.max(nodeMaxY, inputPos.y + NODE_H, outputPos.y + NODE_H) + 40);

  const commit = (id: string, next: { x: number; y: number }) => {
    const base: GraphLayout = { nodes: { ...positions }, endpoints: { input: inputPos, output: outputPos } };
    if (id === 'input' || id === 'output') {
      onLayoutChange({ ...base, endpoints: { ...base.endpoints, [id]: next } });
    } else {
      onLayoutChange({ ...base, nodes: { ...base.nodes, [id]: next } });
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (running || event.button !== 0 || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const current = id === 'input' ? inputPos : id === 'output' ? outputPos : positions[id];
    dragRef.current = {
      id,
      offsetX: event.clientX - rect.left + canvasRef.current.scrollLeft - current.x,
      offsetY: event.clientY - rect.top + canvasRef.current.scrollTop - current.y,
    };
    didDragRef.current = false;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left + canvas.scrollLeft;
    const py = event.clientY - rect.top + canvas.scrollTop;
    if (connectingFrom) setPointer({ x: px, y: py });

    const drag = dragRef.current;
    if (!drag) return;
    const nextX = Math.max(8, Math.min(width - NODE_W - 8, px - drag.offsetX));
    const nextY = Math.max(8, Math.min(height - NODE_H - 8, py - drag.offsetY));
    const previous = drag.id === 'input' ? inputPos : drag.id === 'output' ? outputPos : positions[drag.id];
    if (Math.abs(nextX - previous.x) > 2 || Math.abs(nextY - previous.y) > 2) didDragRef.current = true;
    commit(drag.id, { x: nextX, y: nextY });
  };

  const handlePointerUp = () => {
    dragRef.current = undefined;
    if (connectingFrom) {
      setConnectingFrom(undefined);
      setPointer(undefined);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-glassline bg-gbg-deep/35 px-4 py-2.5 backdrop-blur-glass-sm">
        <p className="flex items-center gap-2 text-[11px] text-gtext-muted">
          <GitBranch className="h-3.5 w-3.5" />
          按依赖深度自动分列 · 拖动可微调，位置会保存
        </p>
        <div className="flex items-center gap-2">
          {connectingFrom && (
            <span className="inline-flex items-center gap-2 rounded-glass-pill border border-glassline-brand bg-gbrand/10 px-2.5 py-1 text-[11px] text-gbrand-text">
              选一个下游节点建立依赖
              <button type="button" onClick={() => setConnectingFrom(undefined)} className="underline-offset-2 hover:underline">
                取消
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={onResetLayout}
            className="inline-flex h-7 items-center gap-1.5 rounded-glass-md border border-glassline bg-glass-2 px-2.5 text-[11px] text-gtext-secondary transition-colors hover:border-glassline-brand hover:text-gbrand-text"
          >
            <LayoutGrid className="h-3 w-3" />
            重新排列
          </button>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="min-h-0 flex-1 overflow-auto scroll-thin [background-image:radial-gradient(var(--glass-border)_1px,transparent_1px)] [background-size:18px_18px]"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div className="relative" style={{ width, height }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            {roots.map((step) => (
              <path key={`in-${step.id}`} d={edgePath(inputPos, positions[step.id])} fill="none" stroke="var(--glass-border-hover)" strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round" />
            ))}
            {ordered.flatMap((step) =>
              step.dependsOn
                .filter((id) => positions[id])
                .map((id) => (
                  <path key={`${id}-${step.id}`} d={edgePath(positions[id], positions[step.id])} fill="none" stroke="var(--gtext-muted)" strokeWidth="1.75" strokeLinecap="round" opacity="0.55" />
                )),
            )}
            {leaves.map((step) => (
              <path key={`out-${step.id}`} d={edgePath(positions[step.id], outputPos)} fill="none" stroke="var(--glass-border-hover)" strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round" />
            ))}
            {connectingFrom && pointer && positions[connectingFrom] && (
              <path
                d={`M ${positions[connectingFrom].x + NODE_W} ${positions[connectingFrom].y + NODE_H / 2} L ${pointer.x} ${pointer.y}`}
                fill="none"
                stroke="rgb(var(--gbrand-rgb))"
                strokeWidth="2"
                strokeDasharray="5 5"
              />
            )}
          </svg>

          <Endpoint kind="input" plan={plan} position={inputPos} onPointerDown={(event) => handlePointerDown(event, 'input')} />

          {ordered.map((step) => (
            <GraphNode
              key={step.id}
              plan={plan}
              step={step}
              position={positions[step.id]}
              selected={selectedStepId === step.id}
              paused={pausedStepIds.includes(step.id)}
              connecting={connectingFrom === step.id}
              onPointerDown={(event) => handlePointerDown(event, step.id)}
              onSelect={() => {
                if (didDragRef.current) {
                  didDragRef.current = false;
                  return;
                }
                onSelectStep(step);
              }}
              onStartConnect={(event) => {
                if (running) return;
                event.stopPropagation();
                setConnectingFrom(step.id);
                const canvas = canvasRef.current;
                if (canvas) {
                  const rect = canvas.getBoundingClientRect();
                  setPointer({ x: event.clientX - rect.left + canvas.scrollLeft, y: event.clientY - rect.top + canvas.scrollTop });
                }
              }}
              onFinishConnect={() => {
                if (connectingFrom && connectingFrom !== step.id) {
                  onConnectSteps(connectingFrom, step.id);
                  setConnectingFrom(undefined);
                  setPointer(undefined);
                }
              }}
            />
          ))}

          <Endpoint kind="output" plan={plan} position={outputPos} onPointerDown={(event) => handlePointerDown(event, 'output')} onViewOutput={onViewOutput} />
        </div>
      </div>
    </div>
  );
}

/** 图上的节点 —— 做成员工工位卡，而不是流程框 */
function GraphNode({
  plan,
  step,
  position,
  selected,
  paused,
  connecting,
  onPointerDown,
  onSelect,
  onStartConnect,
  onFinishConnect,
}: {
  plan: TaskPlan;
  step: TaskPlanStep;
  position: { x: number; y: number };
  selected: boolean;
  paused: boolean;
  connecting: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onSelect: () => void;
  onStartConnect: (event: ReactPointerEvent<HTMLElement>) => void;
  onFinishConnect: () => void;
}) {
  const narration = narrateStep(step, { plan, paused });
  return (
    <div className="absolute" style={{ left: position.x, top: position.y, width: NODE_W, height: NODE_H }}>
      <div
        role="button"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          'group relative h-full cursor-grab rounded-glass-lg border px-3 py-2.5 text-left transition-all duration-200 active:cursor-grabbing',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand-ring',
          selected || narration.tone === 'active'
            ? 'border-glassline-brand bg-glass-2 shadow-glass-md'
            : narration.tone === 'failed'
              ? 'border-gdanger/25 bg-gdanger/[0.06]'
              : 'border-glassline bg-glass-1 shadow-glass-sm hover:border-glassline-hover hover:bg-glass-2',
        )}
      >
        <span
          role="button"
          tabIndex={0}
          aria-label="连接到这个节点"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => {
            event.stopPropagation();
            onFinishConnect();
          }}
          className={cn(
            'absolute -left-2 top-1/2 z-20 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full border-2 bg-gbg-raised transition-colors',
            connecting ? 'border-gbrand' : 'border-glassline group-hover:border-glassline-brand',
          )}
        >
          <span className="h-1 w-1 rounded-full bg-gtext-muted" />
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="从这个节点拉一条依赖"
          onPointerDown={onStartConnect}
          onPointerUp={(event) => event.stopPropagation()}
          className={cn(
            'absolute -right-2 top-1/2 z-20 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full border-2 bg-gbg-raised transition-colors',
            connecting ? 'border-gbrand bg-gbrand/15' : 'border-glassline group-hover:border-glassline-brand',
          )}
        >
          <span className="h-1 w-1 rounded-full bg-gtext-muted" />
        </span>

        <div className="flex items-start gap-2.5">
          <EmployeeBadge name={step.employee.name} avatar={step.employee.avatar} tone={narration.tone} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] tabular-nums text-gtext-muted">{String(step.order).padStart(2, '0')}</span>
              <p className="truncate text-xs font-semibold text-gtext-primary">{step.employee.name}</p>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-gtext-muted">
              {step.employee.position && step.employee.position !== step.employee.name ? step.employee.position : step.title}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <CapabilityTag name={step.capability.name} tone={narration.tone} />
          <span className={cn('ml-auto shrink-0 rounded-glass-pill border px-1.5 py-0.5 text-[9px]', TONE_CHIP[narration.tone])}>
            {narration.label}
          </span>
        </div>
      </div>
    </div>
  );
}

function Endpoint({
  kind,
  plan,
  position,
  onPointerDown,
  onViewOutput,
}: {
  kind: 'input' | 'output';
  plan: TaskPlan;
  position: { x: number; y: number };
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onViewOutput?: () => void;
}) {
  const isInput = kind === 'input';
  const done = plan.status === 'completed';
  return (
    <div className="absolute" style={{ left: position.x, top: position.y, width: NODE_W - 24, height: NODE_H }}>
      <div
        onPointerDown={onPointerDown}
        className={cn(
          'relative flex h-full cursor-grab flex-col justify-between rounded-glass-lg border px-3 py-2.5 active:cursor-grabbing',
          isInput
            ? 'border-glassline-brand bg-gbrand/[0.07]'
            : done
              ? 'border-gsuccess/25 bg-gsuccess/[0.08]'
              : 'border-glassline bg-glass-1',
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'grid h-6 w-6 shrink-0 place-items-center rounded-glass-md',
              isInput ? 'bg-gbrand/15 text-gbrand-text' : 'bg-gsuccess/15 text-gsuccess',
            )}
          >
            {isInput ? <Sparkles className="h-3 w-3" /> : <FileOutput className="h-3 w-3" />}
          </span>
          <p className={cn('text-[10px] font-semibold uppercase tracking-[0.1em]', isInput ? 'text-gbrand-text' : 'text-gsuccess')}>
            {isInput ? '任务输入' : '交付出口'}
          </p>
        </div>
        <p className="line-clamp-2 text-[10px] leading-4 text-gtext-secondary">
          {isInput ? plan.objective : done ? '全部步骤已交付' : '所有末端步骤汇入这里'}
        </p>
        {!isInput && onViewOutput && (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onViewOutput();
            }}
            className="self-start text-[10px] font-medium text-gsuccess underline-offset-2 hover:underline"
          >
            查看结果
          </button>
        )}
      </div>
    </div>
  );
}
