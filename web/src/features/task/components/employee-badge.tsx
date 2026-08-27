'use client';

import { Check, Loader2, Pause, MinusCircle, TriangleAlert } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { StepTone } from '../task-step-state';

/** 工位灯：员工头像右下角的状态点，深底上带光晕 */
const LAMP: Record<StepTone, string> = {
  idle: 'bg-gtext-muted',
  active: 'bg-gbrand shadow-[0_0_0_3px_rgba(129,140,248,0.22)]',
  done: 'bg-gsuccess',
  failed: 'bg-gdanger',
  paused: 'bg-gwarning',
  skipped: 'bg-gtext-disabled',
};

const RING: Record<StepTone, string> = {
  idle: 'ring-glassline',
  active: 'ring-gbrand/60',
  done: 'ring-gsuccess/45',
  failed: 'ring-gdanger/45',
  paused: 'ring-gwarning/45',
  skipped: 'ring-glassline',
};

export const TONE_TEXT: Record<StepTone, string> = {
  idle: 'text-gtext-muted',
  active: 'text-gbrand-text',
  done: 'text-gsuccess',
  failed: 'text-gdanger',
  paused: 'text-gwarning',
  skipped: 'text-gtext-disabled',
};

export const TONE_CHIP: Record<StepTone, string> = {
  idle: 'border-glassline bg-glass-2 text-gtext-muted',
  active: 'border-glassline-brand bg-gbrand/10 text-gbrand-text',
  done: 'border-gsuccess/25 bg-gsuccess/[0.08] text-gsuccess',
  failed: 'border-gdanger/25 bg-gdanger/[0.08] text-gdanger',
  paused: 'border-gwarning/25 bg-gwarning/[0.08] text-gwarning',
  skipped: 'border-glassline bg-glass-1 text-gtext-disabled',
};

const SIZES = {
  sm: { box: 'h-9 w-9', lamp: 'h-2.5 w-2.5', glyph: 'h-2.5 w-2.5' },
  md: { box: 'h-11 w-11', lamp: 'h-3 w-3', glyph: 'h-3 w-3' },
  lg: { box: 'h-14 w-14', lamp: 'h-3.5 w-3.5', glyph: 'h-3 w-3' },
} as const;

/**
 * 带工位灯的员工头像。
 *
 * 重构前员工头像是 7×7 的装饰，挂在节点卡片底部副行 —— 员工被降级成了元数据。
 * 这里把它放大成主体，状态直接长在头像上，让「谁在干活」成为第一视觉信息。
 */
export function EmployeeBadge({
  name,
  avatar,
  tone,
  size = 'md',
  className,
}: {
  name: string;
  avatar: string | null;
  tone: StepTone;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const dims = SIZES[size];
  const Glyph = tone === 'active' ? Loader2 : tone === 'done' ? Check : tone === 'failed' ? TriangleAlert : tone === 'paused' ? Pause : tone === 'skipped' ? MinusCircle : null;

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {tone === 'active' && (
        <span className="absolute -inset-1 rounded-full bg-gbrand/15 motion-safe:animate-pulse-slow" aria-hidden />
      )}
      <Avatar
        name={name}
        src={avatar}
        className={cn('relative ring-2 ring-offset-0', dims.box, RING[tone])}
      />
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full text-white',
          dims.lamp,
          LAMP[tone],
        )}
        aria-hidden
      >
        {Glyph && <Glyph className={cn(dims.glyph, tone === 'active' && 'animate-spin')} strokeWidth={3} />}
      </span>
    </span>
  );
}

/** 技能工牌 —— 员工"带着哪张牌上工" */
export function CapabilityTag({ name, tone = 'idle' }: { name: string; tone?: StepTone }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-glass-pill border px-1.5 py-0.5 text-[10px] font-medium',
        TONE_CHIP[tone],
      )}
      title={name}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}
