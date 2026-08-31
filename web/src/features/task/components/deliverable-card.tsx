'use client';

import { useState } from 'react';
import { Check, ChevronDown, Copy, FileCheck2, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/features/chat/markdown';
import { cn } from '@/lib/utils';
import type { TaskExecutionSnapshot } from '../task-execution';

/**
 * 时间线末尾的交付物卡片。
 *
 * 从右栏 tab 提到流程末端：会议要的是「最终交付结果」，把它放在一个要先点 tab
 * 才看得到的地方，等于让用户自己去找结论。放在时间线尽头，视线走完所有步骤自然
 * 落在它上面 —— 而且完成的那一刻它就出现在滚动位置的下方。
 */
export function DeliverableCard({
  snapshot,
  defaultOpen = true,
}: {
  snapshot: TaskExecutionSnapshot;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const produced = snapshot.steps.filter((step) => step.status === 'completed' && step.output?.trim());
  const employeeCount = new Set(produced.map((step) => step.employee.id)).size;

  const copy = async () => {
    if (!snapshot.deliverable) return;
    try {
      await navigator.clipboard.writeText(snapshot.deliverable);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板被浏览器策略拦了就算了，不值得为此弹错误 */
    }
  };

  // 汇总是 RUN_COMPLETED 之后异步跑的一次模型调用，「已完成但交付物还没到」
  // 是真实存在的中间态。显示成空白会让人以为出问题了。
  if (!snapshot.deliverable) {
    if (snapshot.status === 'completed' && produced.length > 0) {
      return (
        <li className="relative flex gap-3.5">
          <span className="w-14 shrink-0" />
          <div className="min-w-0 flex-1 pb-2">
            <div className="flex items-center gap-2.5 rounded-glass-lg border border-glassline-brand bg-gbrand/[0.06] px-4 py-3.5">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gbrand-text" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gtext-primary">正在汇总最终交付物</p>
                <p className="mt-0.5 text-[11px] text-gtext-muted">
                  {employeeCount} 位员工的产出正在合成一份完整结果
                </p>
              </div>
            </div>
          </div>
        </li>
      );
    }
    return null;
  }

  return (
    <li className="relative flex gap-3.5">
      <div className="relative z-10 shrink-0 pt-2">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-gsuccess text-white ring-2 ring-gsuccess/40">
          <FileCheck2 className="h-6 w-6" strokeWidth={2.2} />
        </span>
      </div>

      <div className="min-w-0 flex-1 pb-2">
        <div className="overflow-hidden rounded-glass-lg border-2 border-gsuccess/40 bg-gsuccess/[0.06] shadow-glass-md">
          <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              className="min-w-0 flex-1 text-left"
              aria-expanded={open}
            >
              <p className="flex items-center gap-2 text-[15px] font-bold text-gtext-primary">
                <Sparkles className="h-4 w-4 text-gsuccess" />
                最终交付物
              </p>
              <p className="mt-0.5 text-[11px] text-gtext-muted">
                汇总了 {employeeCount} 位员工、{produced.length} 步产出 · {snapshot.deliverable.length} 字
                {snapshot.deliverableGeneratedAt &&
                  ` · ${new Date(snapshot.deliverableGeneratedAt).toLocaleString('zh-CN', { hour12: false })}`}
              </p>
            </button>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="glass" className="h-7 px-2.5 text-[11px]" onClick={() => void copy()}>
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? '已复制' : '复制全文'}
              </Button>
              <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-label={open ? '收起交付物' : '展开交付物'}
                className="grid h-7 w-7 place-items-center rounded-glass-md text-gtext-muted transition-colors hover:bg-glass-3 hover:text-gtext-primary"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')} />
              </button>
            </div>
          </div>

          {/* 退化说明必须显眼：机械拼接的东西冒充汇总结果，比没有汇总更糟 */}
          {snapshot.deliverableDegraded && (
            <p className="flex items-start gap-1.5 border-t border-gwarning/25 bg-gwarning/[0.07] px-4 py-2 text-[11px] leading-5 text-gwarning">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              汇总模型当时不可用，这份交付物是按步骤顺序直接拼接的，未经整理。
            </p>
          )}

          {open && (
            <div className="markdown-body max-h-[36rem] overflow-y-auto border-t border-gsuccess/20 px-4 py-4 text-sm leading-6 scroll-thin">
              <Markdown content={snapshot.deliverable} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
