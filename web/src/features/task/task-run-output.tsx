'use client';

import { FileOutput, Sparkles } from 'lucide-react';
import { Markdown } from '@/features/chat/markdown';
import type { TaskPlanStep } from './task-orchestration';

export function TaskRunOutput({ step, finalOutput }: { step?: TaskPlanStep; finalOutput?: string }) {
  const output = finalOutput || step?.output;
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {finalOutput ? <FileOutput className="h-4 w-4 text-primary" /> : <Sparkles className="h-4 w-4 text-primary" />}
        {finalOutput ? '最终交付物' : step ? `${step.employee.name} 的中间结果` : '执行结果'}
      </div>
      {output ? <div className="prose prose-sm mt-3 max-w-none"><Markdown content={output} /></div> : <p className="mt-3 text-sm text-fg-muted">步骤开始执行后，结果会实时显示在这里。</p>}
    </div>
  );
}
