import { cn } from '@/lib/utils';

type StatusType = 'online' | 'offline' | 'busy' | 'connecting';

interface StatusDotProps {
  status: StatusType;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /**
   * 深色/玻璃背景上开启光晕（PRD Phase 1）。
   * 浅色页面保持关闭 —— 白底上的彩色光晕会显得脏。
   */
  glow?: boolean;
  className?: string;
}

/**
 * 圆点走 CSS 变量而不是写死 Tailwind 色阶。
 *
 * 这个组件同时出现在浅色页（/preview、design-preview）和玻璃页
 * （企业端外壳、我的员工列表/详情），两边需要不同的饱和度：
 * green-500 在深底上偏暗且发脏，深底要用调过的 --gsuccess 一档。
 * 变量在 globals.css 的 `:root` 给浅色值、在 `.theme-glass` 覆盖成深底值，
 * 组件本身不需要知道自己在哪个主题里。
 */
const STATUS_CONFIG = {
  online: {
    color: 'bg-[var(--dot-online)]',
    glow: 'shadow-[shadow:var(--dot-online-glow)]',
    label: '在线',
    animate: true,
  },
  offline: {
    color: 'bg-[var(--dot-offline)]',
    glow: 'shadow-[shadow:var(--dot-offline-glow)]',
    label: '离线',
    animate: false,
  },
  busy: {
    color: 'bg-[var(--dot-busy)]',
    glow: 'shadow-[shadow:var(--dot-busy-glow)]',
    label: '忙碌',
    animate: true,
  },
  connecting: {
    color: 'bg-[var(--dot-connecting)]',
    glow: 'shadow-[shadow:var(--dot-connecting-glow)]',
    label: '连接中',
    animate: true,
  },
} as const;

const SIZE_CONFIG = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
} as const;

/**
 * 状态指示器组件
 *
 * 用于显示实时状态（在线/离线/忙碌/连接中）
 *
 * @example
 * ```tsx
 * <StatusDot status="online" showLabel />
 * <StatusDot status="offline" size="sm" />
 * <StatusDot status="busy" />
 * ```
 */
export function StatusDot({
  status,
  showLabel = false,
  size = 'md',
  glow = false,
  className
}: StatusDotProps) {
  const config = STATUS_CONFIG[status];
  const sizeClass = SIZE_CONFIG[size];

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="relative inline-flex">
        <span
          className={cn(
            'inline-flex rounded-full',
            config.color,
            sizeClass,
            glow && config.glow
          )}
        />
        {config.animate && (
          <>
            {/* 呼吸动画环 */}
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                config.color
              )}
              style={{
                animationDuration: status === 'busy' ? '1.5s' : '2s',
              }}
            />
            {/* 脉冲动画环 */}
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-pulse rounded-full opacity-50',
                config.color
              )}
            />
          </>
        )}
      </span>
      {showLabel && (
        <span className="text-xs text-fg-muted">{config.label}</span>
      )}
    </span>
  );
}
