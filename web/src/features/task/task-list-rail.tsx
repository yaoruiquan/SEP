'use client';

import { CheckCircle2, CircleDashed, Clock3, ListTodo, Loader2, Plus, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TaskPlan, TaskRunStatus } from './task-orchestration';

const STATUS: Record<TaskRunStatus, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'text-fg-muted' },
  awaiting_confirmation: { label: '待确认', className: 'text-warning' },
  running: { label: '执行中', className: 'text-info' },
  completed: { label: '已完成', className: 'text-success' },
  failed: { label: '失败', className: 'text-danger' },
  stopped: { label: '已停止', className: 'text-fg-muted' },
};

function StatusIcon({ status }: { status: TaskRunStatus }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-info" />;
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-danger" />;
  if (status === 'awaiting_confirmation') return <Clock3 className="h-4 w-4 text-warning" />;
  return <CircleDashed className="h-4 w-4 text-fg-subtle" />;
}

interface TaskListRailProps {
  tasks: TaskPlan[];
  activeTaskId?: string;
  running: boolean;
  onSelect: (task: TaskPlan) => void;
  onNew: () => void;
}

export function TaskListRail({ tasks, activeTaskId, running, onSelect, onNew }: TaskListRailProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">编排任务</h2>
          <p className="mt-0.5 text-[11px] text-fg-subtle">当前工作区</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onNew}
          disabled={running}
          aria-label="新建编排任务"
          title="新建编排任务"
          className="h-8 w-8"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 scroll-thin">
        {tasks.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center px-4 text-center">
            <ListTodo className="h-6 w-6 text-fg-subtle" />
            <p className="mt-3 text-sm font-medium text-foreground">暂无编排任务</p>
            <p className="mt-1 text-xs leading-5 text-fg-subtle">新任务会出现在这里</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => {
              const completed = task.steps.filter((step) => step.status === 'completed').length;
              const active = task.id === activeTaskId;
              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onSelect(task)}
                  disabled={running && !active}
                  className={cn(
                    'w-full rounded-md border px-3 py-3 text-left transition',
                    active
                      ? 'border-primary/30 bg-primary/[0.04] shadow-sm'
                      : 'border-transparent hover:border-border hover:bg-neutral-50',
                    running && !active && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <StatusIcon status={task.status} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">{task.objective}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className={STATUS[task.status].className}>{STATUS[task.status].label}</span>
                        <span className="text-fg-subtle">{completed}/{task.steps.length} 步</span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-200">
                        <div
                          className={cn('h-full transition-all', task.status === 'failed' ? 'bg-danger' : 'bg-primary')}
                          style={{ width: `${task.steps.length ? (completed / task.steps.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
