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
    <section className="border-b border-border bg-white px-5 py-5 sm:px-7">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <Sparkles className="h-4 w-4" />
          任务目标
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
          <textarea
            value={objective}
            onChange={(event) => onObjectiveChange(event.target.value)}
            placeholder="描述你最终想得到的结果，系统会选择员工、技能并生成执行计划"
            aria-label="任务目标"
            className="min-h-28 w-full resize-none border-0 bg-transparent px-4 py-3.5 text-[15px] leading-6 text-foreground outline-none placeholder:text-fg-subtle"
            disabled={planning}
          />
          <div className="flex flex-col gap-3 border-t border-border bg-neutral-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-fg-subtle">{objective.trim().length}/4000</span>
            <Button
              size="sm"
              onClick={onGenerate}
              disabled={objective.trim().length < 8 || planning}
              className="sm:min-w-32"
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

        {error && <p className="mt-2 text-xs leading-5 text-danger">{error}</p>}

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scroll-thin">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onObjectiveChange(example)}
              disabled={planning}
              className="shrink-0 rounded-md border border-border bg-white px-3 py-1.5 text-xs text-fg-muted transition hover:border-primary/30 hover:text-foreground disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
