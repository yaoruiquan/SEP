import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        // default：中性 pill，主题安全（暗色玻璃作用域自动取深色）。
        // 调用点若自带 bg-*/text-* 会被 twMerge 覆盖（后者优先），行为兼容旧版。
        default: 'bg-muted text-foreground border border-border',
        // 数据强调：teal tint + 主题感知文字（text-secondary-text 两主题都 AA）
        secondary: 'bg-secondary/10 text-secondary-text border border-secondary/20',
        // glass 语义变体 —— PRD: 半透明 + 同色边框
        glass: 'bg-glass-2 text-gtext-primary border border-glassline backdrop-blur-glass-xs',
        'glass-success': 'bg-gsuccess/20 text-gsuccess border border-gsuccess/40 backdrop-blur-glass-xs',
        'glass-warning': 'bg-gwarning/20 text-gwarning border border-gwarning/40 backdrop-blur-glass-xs',
        'glass-danger': 'bg-gdanger/20 text-gdanger border border-gdanger/40 backdrop-blur-glass-xs',
        'glass-info': 'bg-ginfo/20 text-ginfo border border-ginfo/40 backdrop-blur-glass-xs',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({
  className,
  variant,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
