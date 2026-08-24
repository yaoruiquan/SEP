'use client';

import { ArrowDown, CheckCircle2, Clock3, Link2, Sparkles, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { TaskPlan } from './task-orchestration';

interface TaskPlanPreviewProps {
  plan: TaskPlan | null;
  onConfirm: () => void;
  onBack?: () => void;
  confirming?: boolean;
}

function formatDuration(seconds: number) {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`;
}

export function TaskPlanPreview({ plan, onConfirm, onBack, confirming }: TaskPlanPreviewProps) {
  if (!plan) {
    return (
      <div className="flex min-h-[410px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-8 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <h4 className="text-base font-semibold text-foreground">等待任务目标</h4>
        <p className="mt-2 max-w-sm text-sm leading-6 text-fg-muted">
          描述你想要的结果后，这里会展示系统准备调用的硅基员工和执行步骤。
        </p>
      </div>
    );
  }

  const employeeCount = new Set(plan.steps.map((step) => step.employee.id)).size;
  const duration = plan.steps.reduce((total, step) => total + step.estimatedSeconds, 0);

  return (
    <div className="flex min-h-[410px] flex-col">
      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              已生成执行计划
            </div>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{plan.summary}</p>
          </div>
          <Badge variant="glass-info" className="shrink-0">待确认</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{employeeCount} 位员工</span>
          <span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" />{plan.steps.length} 个步骤</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />预计 {formatDuration(duration)}</span>
        </div>
      </div>

      {plan.steps.length === 0 ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          当前没有可用的员工能力，无法生成执行步骤。请先订阅员工并完成能力绑定。
        </div>
      ) : (
        <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
          {plan.steps.map((step, index) => (
            <div key={step.id} className="relative flex gap-3 rounded-xl border border-border bg-background p-3.5">
              <div className="flex shrink-0 flex-col items-center">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {step.order}
                </div>
                {index < plan.steps.length - 1 && <div className="mt-1 h-full min-h-5 w-px bg-border" />}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{step.title}</h4>
                  {step.dependsOn.length > 0 && (
                    <Badge variant="glass" className="gap-1 text-[11px] text-fg-muted">
                      <ArrowDown className="h-3 w-3" />依赖前序步骤
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{step.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Avatar name={step.employee.name} src={step.employee.avatar} className="h-6 w-6 text-[10px]" />
                  <span className="text-xs font-medium text-foreground">{step.employee.name}</span>
                  <span className="text-fg-subtle">·</span>
                  <Badge variant="glass" className="text-[11px]">{step.capability.name}</Badge>
                  <span className="text-xs text-fg-subtle">约 {formatDuration(step.estimatedSeconds)}</span>
                </div>
                <p className="mt-2 text-[11px] text-fg-subtle">{step.rationale}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        {onBack && <Button type="button" variant="secondary" size="sm" onClick={onBack}>返回修改</Button>}
        <Button type="button" size="sm" disabled={plan.steps.length === 0 || confirming} onClick={onConfirm}>
          {confirming ? '正在启动…' : '确认并开始执行'}
        </Button>
      </div>
    </div>
  );
}
