'use client';

import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const EXAMPLES = [
  '分析最近三个月销售数据，找出异常并生成管理层报告',
  '调研三个主要竞品，整理产品能力和定价对比简报',
  '为新品制定一周的小红书内容计划并输出完整文案',
];

interface TaskObjectiveComposerProps {
  objective: string;
  planning: boolean;
  error?: string;
  onObjectiveChange: (value: string) => void;
  onGenerate: () => void;
}

export function TaskObjectiveComposer({
  objective,
  planning,
  error,
  onObjectiveChange,
  onGenerate,
}: TaskObjectiveComposerProps) {
  return (
    <section className="shrink-0 border-b border-border bg-white px-5 py-4 sm:px-6">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <Sparkles className="h-4 w-4" />
          描述任务目标
        </div>
        <div className="mt-2.5 grid overflow-hidden rounded-md border border-neutral-300 bg-white transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 lg:grid-cols-[minmax(0,1fr)_auto]">
          <textarea
            value={objective}
            onChange={(event) => onObjectiveChange(event.target.value)}
            placeholder="描述你最终想得到的结果，系统会选择员工、技能并生成执行计划"
            aria-label="任务目标"
            className="min-h-20 w-full resize-none border-0 bg-transparent px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-fg-subtle lg:min-h-24"
            disabled={planning}
          />
          <div className="flex items-end justify-between gap-3 border-t border-border bg-neutral-50 px-3 py-2.5 lg:w-44 lg:flex-col lg:items-stretch lg:justify-between lg:border-l lg:border-t-0">
            <span className="text-[11px] text-fg-subtle">{objective.trim().length}/4000</span>
            <Button
              size="sm"
              onClick={onGenerate}
              disabled={objective.trim().length < 8 || planning}
              className="lg:w-full"
            >
              {planning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在规划
                </>
              ) : (
                <>
                  生成执行计划
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-danger/20 bg-danger/5 px-3 py-2">
            <p className="text-xs text-danger">计划暂时没有生成，员工尚未开始执行。</p>
            <button type="button" onClick={onGenerate} className="shrink-0 text-xs font-medium text-danger hover:underline">重新生成</button>
          </div>
        )}

        <div className="mt-2 flex gap-2 overflow-hidden">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onObjectiveChange(example)}
              disabled={planning}
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-white px-3 py-1.5 text-left text-[11px] text-fg-muted transition hover:border-primary/30 hover:text-foreground disabled:opacity-50"
              title={example}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
