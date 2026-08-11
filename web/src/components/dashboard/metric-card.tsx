import { cn } from '@/lib/utils';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    direction: 'up' | 'down';
    value: number;
    label?: string;
  };
  /**
   * 'solid'（默认）= 现有浅色卡片，保持 20+ 存量页面不变。
   * 'glass' = 玻璃卡 + 渐变数字，需放在 .theme-glass 作用域内（PRD Phase 1）。
   */
  variant?: 'solid' | 'glass';
  className?: string;
}

/**
 * Dashboard 指标卡片组件
 *
 * 显示关键业务指标，带趋势指示器
 *
 * @example
 * ```tsx
 * <MetricCard
 *   title="硅基员工"
 *   value={12}
 *   icon={Bot}
 *   trend={{ direction: 'up', value: 20, label: '较上月' }}
 * />
 * ```
 */
export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  variant = 'solid',
  className,
}: MetricCardProps) {
  const isGlass = variant === 'glass';
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : TrendingDown;
  const trendColor = isGlass
    ? trend?.direction === 'up'
      ? 'text-gsuccess'
      : 'text-gdanger'
    : trend?.direction === 'up'
      ? 'text-green-600'
      : 'text-red-600';

  return (
    <div
      className={cn(
        'group relative overflow-hidden p-5 transition-all duration-300',
        isGlass
          ? 'glass-card glass-card-interactive'
          : [
              'rounded-lg border border-neutral-200 bg-white shadow-card',
              'hover:border-neutral-300 hover:shadow-card-hover',
            ],
        className
      )}
    >
      {/* 背景装饰 */}
      <div
        className={cn(
          'absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full transition-transform duration-500 group-hover:scale-150',
          isGlass ? 'bg-gbrand-text/15' : 'bg-primary/5'
        )}
      />

      <div className="relative">
        {/* 标题和图标 */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p
              className={cn(
                'text-sm font-medium',
                isGlass ? 'text-gtext-secondary' : 'text-neutral-600'
              )}
            >
              {title}
            </p>
            {/* 玻璃态用渐变数字（PRD Phase 1） */}
            <p
              className={cn(
                'text-2xl font-semibold',
                // inline-block 是必须的：background-clip:text 在 block 元素上
                // 会把渐变拉满整行宽度，数字只吃到最左边一小段颜色。
                isGlass ? 'gradient-text-glass inline-block' : 'text-neutral-900'
              )}
            >
              {value}
            </p>
          </div>
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
              isGlass
                ? 'bg-glass-2 border border-glassline group-hover:bg-glass-3'
                : 'bg-primary/10 group-hover:bg-primary/20'
            )}
          >
            <Icon
              className={cn('h-5 w-5', isGlass ? 'text-gbrand-text' : 'text-primary')}
            />
          </div>
        </div>

        {/* 趋势指示器 */}
        {trend && (
          <div className={cn('mt-3 flex items-center gap-1 text-xs font-medium', trendColor)}>
            <TrendIcon className="h-3.5 w-3.5" />
            <span>{trend.value}%</span>
            {trend.label && (
              <span className={cn('ml-1', isGlass ? 'text-gtext-muted' : 'text-neutral-500')}>
                {trend.label}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
