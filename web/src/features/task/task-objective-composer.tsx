'use client';

import { ArrowRight, FileText, Loader2, Search, Sparkles } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ComposerEmployee {
  id: string;
  name: string;
  avatar: string | null;
}

interface TaskObjectiveComposerProps {
  objective: string;
  planning: boolean;
  error?: string;
  employees?: ComposerEmployee[];
  employeeCount?: number;
  onObjectiveChange: (value: string) => void;
  onGenerate: () => void;
}

const EXAMPLES = [
  { label: '调研竞品', value: '调研三个竞品，整理功能与定价对比并输出简报', icon: Search },
  { label: '整理会议纪要', value: '整理今天的会议纪要，提炼关键结论与待办事项', icon: FileText },
  { label: '生成产品方案', value: '根据需求生成一份清晰的产品方案和落地路线图', icon: Sparkles },
];

const MAX_LENGTH = 4000;
const MIN_LENGTH = 8;

function composerState(objective: string, planning: boolean) {
  if (planning) {
    return {
      tone: 'planning' as const,
      label: '正在为你安排合适的员工',
      detail: '我会先理解目标，再生成一份可确认的执行计划',
    };
  }
  if (objective.trim()) {
    return {
      tone: 'typing' as const,
      label: '我正在理解你的任务',
      detail: '描述得越具体，员工分工和交付结果就越准确',
    };
  }
  return {
    tone: 'idle' as const,
    label: '你的硅基团队已准备好',
    detail: '告诉我今天想完成什么，我来安排合适的员工',
  };
}

const STATE_CHIP = {
  planning: 'border-glassline-brand bg-gbrand/10 text-gbrand-text',
  typing: 'border-glassline bg-glass-2 text-gtext-primary',
  idle: 'border-gsuccess/28 bg-gsuccess/10 text-gsuccess',
} as const;

const STATE_DOT = {
  planning: 'bg-gbrand motion-safe:animate-pulse',
  typing: 'bg-gwarning',
  idle: 'bg-gsuccess motion-safe:animate-pulse',
} as const;

export function TaskObjectiveComposer({
  objective,
  planning,
  error,
  employees = [],
  employeeCount = employees.length,
  onObjectiveChange,
  onGenerate,
}: TaskObjectiveComposerProps) {
  const state = composerState(objective, planning);
  const trimmed = objective.trim();
  const canSubmit = trimmed.length >= MIN_LENGTH && !planning;
  const visible = employees.slice(0, 4);

  return (
    <section className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 py-6 sm:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_at_top,rgb(var(--gbrand-rgb)/0.10),transparent_70%)]" />

      <div className="relative flex w-full max-w-2xl flex-col items-center">
        <div className="flex flex-col items-center text-center">
          <div className="relative flex h-[72px] items-end justify-center px-3">
            <div className="absolute bottom-1 h-14 w-32 rounded-full bg-gbrand/15 blur-2xl" />
            <div className="relative flex items-center -space-x-3">
              {visible.length > 0 ? (
                visible.map((employee, index) => (
                  <div
                    key={employee.id}
                    className={cn(
                      'relative rounded-full ring-[3px] ring-gbg-canvas',
                      index === 0 && 'z-40',
                      index === 1 && 'z-30 -translate-y-1',
                      index === 2 && 'z-20 translate-y-1',
                      index === 3 && 'z-10 -translate-y-0.5',
                    )}
                  >
                    <Avatar name={employee.name} src={employee.avatar} className="h-12 w-12 text-sm" />
                    {index === 0 && (
                      <>
                        <span className="pointer-events-none absolute -inset-1 rounded-full border border-glassline-brand motion-safe:animate-pulse" />
                        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-gsuccess ring-2 ring-gbg-canvas motion-safe:animate-pulse" />
                      </>
                    )}
                  </div>
                ))
              ) : (
                <div className="relative rounded-full ring-[3px] ring-gbg-canvas">
                  <div className="grid h-12 w-12 place-items-center rounded-full border border-glassline-brand bg-gbrand/10 text-gbrand-text">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-gwarning ring-2 ring-gbg-canvas" />
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2" aria-live="polite">
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-glass-pill border px-3 py-1.5 text-sm font-semibold',
                STATE_CHIP[state.tone],
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', STATE_DOT[state.tone])} />
              {state.label}
            </span>
            {state.tone === 'planning' && <Loader2 className="h-3.5 w-3.5 animate-spin text-gbrand-text" />}
          </div>
          <p className="mt-1.5 max-w-md text-xs leading-5 text-gtext-muted">{state.detail}</p>
        </div>

        <div
          className={cn(
            'mt-6 w-full overflow-hidden rounded-glass-xl border bg-glass-1 shadow-glass-md transition-all duration-200',
            state.tone === 'planning'
              ? 'border-glassline-brand shadow-glow-brand'
              : 'border-glassline focus-within:border-glassline-brand focus-within:shadow-glow-brand',
          )}
        >
          <textarea
            value={objective}
            onChange={(event) => onObjectiveChange(event.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSubmit) {
                event.preventDefault();
                onGenerate();
              }
            }}
            placeholder="描述一个你想完成的任务"
            aria-label="任务目标"
            disabled={planning}
            className="!outline-none min-h-[120px] w-full resize-none border-0 bg-transparent px-5 py-5 text-[15px] leading-7 text-gtext-primary placeholder:text-gtext-muted disabled:opacity-70 sm:min-h-[132px] sm:px-6"
          />
          <div className="flex flex-col gap-3 border-t border-glassline px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="text-[11px] text-gtext-muted">
              {trimmed.length > 0 && trimmed.length < MIN_LENGTH ? `再多描述 ${MIN_LENGTH - trimmed.length} 个字 · ` : ''}
              {trimmed.length}/{MAX_LENGTH}
              <span className="ml-2 hidden text-gtext-disabled sm:inline">⌘↵ 开始</span>
            </span>
            <Button
              size="sm"
              variant="glass-primary"
              onClick={onGenerate}
              disabled={!canSubmit}
              className="h-9 w-full px-4 sm:w-auto"
            >
              {planning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在规划
                </>
              ) : (
                <>
                  开始编排
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex w-full flex-wrap items-center justify-center gap-2">
          <span className="mr-1 text-[11px] text-gtext-muted">试试</span>
          {EXAMPLES.map((example) => {
            const Icon = example.icon;
            return (
              <button
                key={example.label}
                type="button"
                disabled={planning}
                onClick={() => onObjectiveChange(example.value)}
                className="inline-flex h-8 items-center gap-1.5 rounded-glass-pill border border-glassline bg-glass-1 px-3 text-xs text-gtext-secondary transition-all duration-200 hover:border-glassline-brand hover:bg-gbrand/[0.08] hover:text-gbrand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="h-3.5 w-3.5" />
                {example.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div
            className="mt-4 flex w-full items-center justify-between gap-3 rounded-glass-lg border border-gdanger/28 bg-gdanger/10 px-3.5 py-3"
            role="alert"
          >
            <p className="min-w-0 truncate text-xs text-gdanger">{error || '计划暂时没有生成，请稍后重试。'}</p>
            <button
              type="button"
              onClick={onGenerate}
              disabled={planning || !canSubmit}
              className="shrink-0 text-xs font-medium text-gdanger underline-offset-2 hover:underline disabled:opacity-50"
            >
              重新生成
            </button>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2 text-[11px] text-gtext-muted">
          <span className={cn('h-1.5 w-1.5 rounded-full', employeeCount > 0 ? 'bg-gsuccess motion-safe:animate-pulse' : 'bg-gwarning')} />
          {employeeCount > 0 ? `${employeeCount} 位员工在线，随时可以开始工作` : '正在同步可调用员工'}
        </div>
      </div>
    </section>
  );
}
