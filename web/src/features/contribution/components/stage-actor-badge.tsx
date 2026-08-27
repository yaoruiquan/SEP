import { Cpu, Gavel, ShieldCheck, Store, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACTOR_META } from '../contribution-status';
import type { StageActor } from '../pipeline-model';

const ICONS = {
  user: UserRound,
  shield: ShieldCheck,
  gavel: Gavel,
  cpu: Cpu,
  store: Store,
} as const;

/**
 * 经办人徽章。
 *
 * 拟人化只给真实的人（贡献者 / 企业管理员 / 平台运营）——他们拿到带底色的圆形头像位。
 * 系统与市场是中性方形图标，"人 vs 机器"的形状差异本身就是信息。
 */
export function StageActorBadge({
  actor,
  size = 'sm',
  className,
}: {
  actor: StageActor;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const meta = ACTOR_META[actor.kind];
  const Icon = ICONS[meta.icon];
  const box = size === 'md' ? 'h-8 w-8' : 'h-6 w-6';
  const glyph = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center border',
        box,
        meta.humanized
          ? 'rounded-glass-pill border-glassline-brand/50 bg-gbrand/10 text-gbrand-text'
          : 'rounded-glass-md border-glassline bg-glass-2 text-gtext-muted',
        className,
      )}
      title={actor.label}
      aria-hidden
    >
      <Icon className={glyph} />
    </span>
  );
}

export function StageActorLine({ actor, fact }: { actor: StageActor; fact: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-xs text-gtext-muted">
      <StageActorBadge actor={actor} />
      <span className="min-w-0 truncate leading-5">{fact}</span>
    </span>
  );
}
