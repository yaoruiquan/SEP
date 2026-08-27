'use client';

import { useEffect, useState } from 'react';
import { FileOutput, X } from 'lucide-react';
import { Markdown } from '@/features/chat/markdown';
import { cn } from '@/lib/utils';
import type { TaskPlan } from '../task-orchestration';
import { formatDuration, narrateStep } from '../task-step-state';
import { EmployeeBadge } from './employee-badge';

/**
 * 运行结果面板。
 *
 * 重构前叫「交付产物」，内容却是 `[...steps].reverse().find(s => s.output)` ——
 * "最后一个有输出的步骤"。多步任务里最后一步失败时，它会拿倒数第二步的输出
 * 冒充交付物。这里正名为「运行结果」，并把有输出的步骤列出来让人自己翻，
 * 不再假装存在一份汇总产物。
 */
export function TaskResultDialog({
  plan,
  open,
  initialStepId,
  onOpenChange,
}: {
  plan: TaskPlan;
  open: boolean;
  initialStepId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const produced = [...plan.steps]
    .sort((left, right) => left.order - right.order)
    .filter((step) => Boolean(step.output));
  const [activeId, setActiveId] = useState<string | undefined>(initialStepId ?? produced[produced.length - 1]?.id);

  useEffect(() => {
    if (!open) return;
    setActiveId(initialStepId ?? produced[produced.length - 1]?.id);
    // produced 每次渲染都是新数组，只在开关和入参变化时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStepId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open || produced.length === 0) return null;
  const active = produced.find((step) => step.id === activeId) ?? produced[produced.length - 1];

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-gbg-deep/60 px-4 backdrop-blur-glass-xs"
      onClick={() => onOpenChange(false)}
      role="presentation"
    >
      <section
        className="flex max-h-[min(82vh,44rem)] w-full max-w-3xl flex-col overflow-hidden rounded-glass-xl border border-glassline bg-gbg-raised shadow-glass-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="运行结果"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-glassline px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-gtext-primary">
              <FileOutput className="h-4 w-4 text-gsuccess" />
              运行结果
            </p>
            <p className="mt-1 truncate text-xs text-gtext-muted">
              {plan.objective} · {produced.length} 步产生了输出
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-glass-md text-gtext-muted transition-colors hover:bg-glass-2 hover:text-gtext-primary"
            aria-label="关闭运行结果"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {produced.length > 1 && (
            <nav className="w-52 shrink-0 overflow-y-auto border-r border-glassline p-2 scroll-thin" aria-label="步骤输出">
              {produced.map((step) => {
                const narration = narrateStep(step, { plan });
                const selected = step.id === active.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setActiveId(step.id)}
                    className={cn(
                      'mb-1 flex w-full items-center gap-2 rounded-glass-md px-2 py-2 text-left transition-colors duration-200',
                      selected ? 'bg-glass-2 text-gtext-primary' : 'text-gtext-secondary hover:bg-glass-1',
                    )}
                  >
                    <EmployeeBadge name={step.employee.name} avatar={step.employee.avatar} tone={narration.tone} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">{step.employee.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-gtext-muted">
                        第 {step.order} 步{step.durationMs ? ` · ${formatDuration(step.durationMs)}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          )}

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
            <div className="flex items-center gap-2.5 border-b border-glassline pb-3">
              <EmployeeBadge
                name={active.employee.name}
                avatar={active.employee.avatar}
                tone={narrateStep(active, { plan }).tone}
                size="md"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gtext-primary">{active.employee.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-gtext-muted">
                  第 {active.order} 步 · {active.capability.name}
                  {active.durationMs ? ` · 用了 ${formatDuration(active.durationMs)}` : ''}
                </p>
              </div>
            </div>
            <div className="markdown-body mt-4 text-sm leading-6">
              <Markdown content={active.output ?? ''} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
