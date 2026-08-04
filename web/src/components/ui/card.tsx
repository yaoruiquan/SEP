import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const cardVariants = cva(
  'rounded shadow-sm',
  {
    variants: {
      variant: {
        // 实心 —— 表格 / 长列表容器专用。PRD Phase 4 明确要求运营端表格与
        // 审核列表保持实心背景（backdrop-filter 在滚动容器内每帧重算，必掉帧）。
        // 在 .theme-glass 作用域内，bg-card 经令牌桥自动指向深色实心表面。
        solid: 'border border-border bg-card',
        glass: 'glass-card', // 用 globals.css 里已有的 .glass-card 工具类
      },
    },
    // Phase 4 起默认玻璃：22 个调用页全部已包进 .theme-glass 外壳
    // （(enterprise) / (platform) 两个路由组）。作用域外仅剩 /preview
    // 一个浅色组件测试页，已显式 variant="solid"。
    defaultVariants: { variant: 'glass' },
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
