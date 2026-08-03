'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';
import { useSubscriptions } from '@/features/subscription/use-subscriptions';

interface LaunchTaskDialogProps {
  open: boolean;
  creating?: boolean;
  onClose: () => void;
  onCreate: (employeeId: string, taskContent: string) => void;
}

export function LaunchTaskDialog({
  open,
  creating,
  onClose,
  onCreate,
}: LaunchTaskDialogProps) {
  const { data: subs = [], isLoading } = useSubscriptions();
  const [selected, setSelected] = useState<string | null>(null);
  const [taskContent, setTaskContent] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(null);
      setTaskContent('');
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = selected && taskContent.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !creating && onClose()}
      />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-white shadow-md">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="text-base font-semibold text-foreground">发起任务</h3>
          <button
            type="button"
            onClick={() => !creating && onClose()}
            className="rounded p-1 text-fg-subtle hover:bg-muted"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 选择员工 */}
          <div>
            <label className="block text-sm font-medium mb-2">
              选择碳基员工 <span className="text-red-500">*</span>
            </label>
            {isLoading ? (
              <CenteredSpinner label="加载订阅…" />
            ) : subs.length === 0 ? (
              <EmptyState
                title="你还没有订阅任何员工"
                description="先去员工广场订阅一位碳基员工吧。"
                action={
                  <Link href="/marketplace">
                    <Button size="sm">前往员工广场</Button>
                  </Link>
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto scroll-thin">
                {subs.map((sub) => {
                  const emp = sub.employee;
                  const active = selected === emp.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSelected(emp.id)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        active
                          ? 'border-primary/40 bg-primary-subtle'
                          : 'border-border hover:bg-muted',
                      )}
                    >
                      <Avatar
                        name={emp.name}
                        src={emp.avatar}
                        className="h-10 w-10 shrink-0 text-sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-sm font-medium text-foreground">
                          {emp.name}
                        </p>
                        <p className="line-clamp-1 text-xs text-fg-muted">
                          {emp.position}
                        </p>
                      </div>
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 任务内容 */}
          <div>
            <label htmlFor="task-content" className="block text-sm font-medium mb-2">
              任务内容 <span className="text-red-500">*</span>
            </label>
            <textarea
              id="task-content"
              value={taskContent}
              onChange={(e) => setTaskContent(e.target.value)}
              placeholder="请描述你希望该员工完成的任务，例如：分析最近三个月的销售数据并生成趋势报告"
              className="w-full min-h-32 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={creating}
            />
            <p className="text-xs text-fg-subtle mt-1">
              {taskContent.length} 字符
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={creating}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit || creating}
            onClick={() => selected && taskContent && onCreate(selected, taskContent)}
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            创建任务
          </Button>
        </div>
      </div>
    </div>
  );
}
