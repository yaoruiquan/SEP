'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, CenteredSpinner } from '@/components/ui/feedback';
import { useTaskCandidates } from './use-task-candidates';
import { buildTaskPlan } from './task-planner';
import { TaskPlanPreview } from './task-plan-preview';
import type { TaskPlan } from './task-orchestration';

interface LaunchTaskDialogProps {
  open: boolean;
  creating?: boolean;
  onClose: () => void;
  onCreate: (plan: TaskPlan) => void;
}

const EXAMPLES = [
  '分析最近三个月销售数据并输出经营分析报告',
  '调研三个竞品，整理一份市场对比简报',
  '为新品写一组适合小红书发布的推广文案',
];

export function LaunchTaskDialog({ open, creating, onClose, onCreate }: LaunchTaskDialogProps) {
  const { candidates, isLoading, error, hasSubscriptions } = useTaskCandidates();
  const [objective, setObjective] = useState('');

  useEffect(() => {
    if (open) setObjective('');
  }, [open]);

  const plan = useMemo<TaskPlan | null>(() => {
    if (objective.trim().length < 8 || isLoading) return null;
    return buildTaskPlan(objective, candidates);
  }, [candidates, isLoading, objective]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !creating && onClose()} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">Task Orchestration</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">发起编排任务</h3>
          </div>
          <button type="button" onClick={() => !creating && onClose()} className="rounded p-1.5 text-fg-subtle hover:bg-muted" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex min-h-[480px] items-center justify-center"><CenteredSpinner label="正在读取可用硅基员工…" /></div>
        ) : !hasSubscriptions ? (
          <div className="p-8"><EmptyState title="还没有可用的硅基员工" description="先去员工广场订阅员工，任务编排器才能为你安排执行角色。" action={<Link href="/marketplace"><Button size="sm">前往员工广场<ArrowRight className="ml-1.5 h-4 w-4" /></Button></Link>} /></div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[minmax(260px,0.8fr)_minmax(480px,1.2fr)]">
            <div className="flex min-h-[410px] flex-col">
              <div>
                <label htmlFor="task-objective" className="text-sm font-semibold text-foreground">你想完成什么？</label>
                <p className="mt-1 text-xs leading-5 text-fg-muted">只描述最终目标，不必提前决定由谁来做。系统会根据员工能力自动安排步骤。</p>
                <textarea
                  id="task-objective"
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  placeholder="例如：整理本周销售数据，找出异常并生成一份管理层简报"
                  className="mt-4 min-h-44 w-full resize-none rounded-xl border border-border bg-background px-3.5 py-3 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                  disabled={creating}
                />
                <div className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
                  <span>支持自然语言目标</span>
                  <span>{objective.length} 字</span>
                </div>
              </div>
              <div className="mt-6">
                <p className="text-xs font-medium text-fg-muted">试试这些任务</p>
                <div className="mt-2 space-y-2">
                  {EXAMPLES.map((example) => (
                    <button key={example} type="button" onClick={() => setObjective(example)} className="block w-full rounded-lg border border-border px-3 py-2 text-left text-xs leading-5 text-fg-muted transition hover:border-primary/40 hover:bg-primary/[0.03]">
                      {example}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="mt-auto pt-5 text-xs text-danger">员工能力读取失败，请刷新后重试。</p>}
            </div>
            <TaskPlanPreview plan={plan} onConfirm={() => plan && onCreate(plan)} confirming={creating} />
          </div>
        )}
        {creating && <div className="absolute inset-0 flex items-center justify-center bg-white/55"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>}
      </div>
    </div>
  );
}
