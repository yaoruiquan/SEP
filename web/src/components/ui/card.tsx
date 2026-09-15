import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const cardVariants = cva(
  'rounded-glass-lg',
  {
    variants: {
      variant: {
        // 实心 —— 默认材质。表格、列表、统计区一律用它：backdrop-filter 在
        // 滚动容器里每帧重算，长列表必掉帧，而且内容会跟着背景 blob 一起晃，
        // 观感发脏。在 .theme-glass / .theme-glass-light 作用域内，bg-card 经
        // 令牌桥自动解析成当前主题的实心表面。
        solid: 'border border-border bg-card shadow-glass-sm',
        // 玻璃 —— 场景化材质，只在深色模式强调区、营销位、Hero 上显式启用。
        glass: 'glass-card',
      },
    },
    defaultVariants: { variant: 'solid' },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({
  className,
  variant,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pb-2', className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-base font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-fg-muted', className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-2', className)} {...props} />;
}
