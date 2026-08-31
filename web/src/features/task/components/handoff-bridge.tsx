'use client';

import { ArrowRight, ChevronDown, Handshake } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { TaskHandoffEntry } from '../task-execution';

export interface HandoffBridgeProps {
  /** 下游员工名，用来把箭头补全成「A → B」 */
  toEmployeeName: string;
  entries: TaskHandoffEntry[];
  /** 计划里声明了依赖但上游还没交付时，显示「等待交接」的占位态 */
  pending?: { fromEmployeeName: string; fromStepTitle: string }[];
  onJumpToStep?: (stepKey: string) => void;
}

/**
 * 交接桥 —— 两张步骤卡之间的独立一块。
 *
 * 这是这次返工的核心。改造前「交接」只是下游卡片里的一枚小胶囊，用户看到的是
 * 「一列卡片」而不是「一次接力」。会议要的恰恰是接力这件事肉眼可见，所以把它
 * 提到卡片之间、给它自己的边框和标题，让视线必须经过它才能到下一步。
 */
export function HandoffBridge({ toEmployeeName, entries, pending = [], onJumpToStep }: HandoffBridgeProps) {
  const [openKey, setOpenKey] = useState<string>();

  if (entries.length === 0 && pending.length === 0) return null;

  // 还没发生的交接：只画一条虚线占位，不要做成和已发生的一样醒目 ——
  // 否则用户会以为已经交接过了
  if (entries.length === 0) {
    return (
      <li className="relative flex gap-3.5" aria-hidden={false}>
        <span className="w-14 shrink-0" />
        <div className="min-w-0 flex-1 py-1">
          <p className="flex items-center gap-1.5 text-[11px] text-gtext-disabled">
            <Handshake className="h-3 w-3" />
            等 {pending.map((item) => item.fromEmployeeName).join('、')} 交付后交给 {toEmployeeName}
          </p>
        </div>
      </li>
    );
  }

  const total = entries.reduce((sum, entry) => sum + entry.chars, 0);

  return (
    <li className="relative flex gap-3.5">
      {/* 竖轴留白与步骤卡对齐，让「桥」看起来是长在时间线上的 */}
      <span className="w-14 shrink-0" />

      <div className="min-w-0 flex-1 py-1.5">
        <div className="overflow-hidden rounded-glass-lg border border-gsuccess/30 bg-gsuccess/[0.06]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
            <span className="inline-flex items-center gap-1 rounded-glass-pill bg-gsuccess px-2 py-0.5 text-[10px] font-bold text-white">
              <Handshake className="h-2.5 w-2.5" />
              交接
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] font-medium text-gtext-primary">
              {entries.map((entry, index) => (
                <span key={entry.fromStepKey} className="inline-flex items-center gap-1">
                  {index > 0 && <span className="text-gtext-muted">、</span>}
                  {entry.fromEmployeeName}
                </span>
              ))}
              <ArrowRight className="h-3 w-3 shrink-0 text-gsuccess" />
              {toEmployeeName}
            </span>
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-gsuccess">
              共 {total} 字
            </span>
          </div>

          <div className="space-y-1 border-t border-gsuccess/20 px-3 py-2">
            {entries.map((entry) => {
              const open = openKey === entry.fromStepKey;
              return (
                <div key={entry.fromStepKey}>
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-[11px] leading-5 text-gtext-secondary">
                      「{entry.fromStepTitle}」· {entry.excerpt.slice(0, 60)}
                      {entry.excerpt.length > 60 ? '…' : ''}
                    </p>
                    <button
                      type="button"
                      onClick={() => setOpenKey(open ? undefined : entry.fromStepKey)}
                      className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-gsuccess transition-colors hover:underline"
                    >
                      <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                      {open ? '收起' : '看交接内容'}
                    </button>
                  </div>

                  {open && (
                    <div className="mt-1.5 rounded-glass-md border border-gsuccess/20 bg-gbg-deep/30 px-2.5 py-2">
                      <p className="whitespace-pre-wrap text-[11px] leading-5 text-gtext-secondary">
                        {entry.excerpt}
                      </p>
                      {onJumpToStep && (
                        <button
                          type="button"
                          onClick={() => onJumpToStep(entry.fromStepKey)}
                          className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-gsuccess hover:underline"
                        >
                          跳到第 {entry.fromStepKey.replace(/^step-/, '')} 步看全文（{entry.chars} 字）
                          <ArrowRight className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </li>
  );
}
