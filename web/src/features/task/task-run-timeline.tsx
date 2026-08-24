'use client';

import { CheckCircle2, Circle, Loader2, XCircle, Zap } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { TaskPlanStep } from './task-orchestration';

const labels = {
  queued: '排队中', running: '执行中', completed: '已完成', failed: '失败', skipped: '已跳过',
} as const;

export function TaskRunTimeline({ steps, activeStepId, onSelect }: { steps: TaskPlanStep[]; activeStepId?: string; onSelect?: (step: TaskPlanStep) => void }) {
  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const active = activeStepId === step.id;
        return (
          <button key={step.id} type="button" onClick={() => onSelect?.(step)} className={`relative flex w-full gap-3 rounded-xl border p-3 text-left transition ${active ? 'border-primary/40 bg-primary/[0.04] shadow-sm' : 'border-border bg-background hover:border-primary/20'}`}>
            <div className="flex shrink-0 flex-col items-center">
              {step.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-success" />}
              {step.status === 'running' && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
              {step.status === 'failed' && <XCircle className="h-5 w-5 text-danger" />}
              {step.status === 'queued' && <Circle className="h-5 w-5 text-fg-subtle" />}
              {step.status === 'skipped' && <Circle className="h-5 w-5 text-fg-subtle" />}
              {index < steps.length - 1 && <div className="mt-2 h-full min-h-5 w-px bg-border" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{step.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Avatar name={step.employee.name} src={step.employee.avatar} className="h-5 w-5 text-[9px]" />
                    <span className="text-xs text-fg-muted">{step.employee.name}</span>
                    <span className="text-fg-subtle">·</span>
                    <span className="text-xs text-fg-muted">{step.capability.name}</span>
                  </div>
                </div>
                <Badge variant={step.status === 'failed' ? 'glass-danger' : step.status === 'running' ? 'glass-info' : 'glass'} className="shrink-0 text-[11px]">{labels[step.status]}</Badge>
              </div>
              {step.status === 'running' && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(8, step.progress)}%` }} /></div>}
              {step.status === 'completed' && step.durationMs != null && <p className="mt-2 text-[11px] text-fg-subtle">耗时 {(step.durationMs / 1000).toFixed(1)} 秒</p>}
              {step.status === 'failed' && step.error && <p className="mt-2 line-clamp-2 text-[11px] text-danger">{step.error}</p>}
            </div>
            {active && <Zap className="absolute right-3 top-3 h-3.5 w-3.5 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
