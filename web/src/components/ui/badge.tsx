import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        // default 不设任何样式，让 className 完全控制（保持现有调用点行为）
        default: '',
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
