import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from './loading';

/**
 * 导出以便给 <Link> 之类的非 button 元素套同样的样式。
 * 本组件不支持 Radix 的 asChild —— 需要"看起来像按钮的链接"时，
 * 用 `className={cn(buttonVariants({ ... }))}` 直接作用在 <Link> 上。
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white hover:bg-primary-hover shadow-sm hover:shadow',
        secondary:
          'bg-white text-neutral-900 border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300',
        outline:
          'bg-transparent text-neutral-700 border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300',
        ghost: 'text-neutral-700 hover:bg-neutral-100',
        danger: 'bg-danger text-white hover:bg-danger-600 shadow-sm hover:shadow',
        link: 'text-primary underline-offset-4 hover:underline',
        // PRD Phase 1: 玻璃按钮 —— 半透明底 + blur + 亮边
        // 深底上 ring-offset 默认取白色会出现白圈，故 offset 归零、ring 换品牌色
        glass:
          'bg-glass-2 text-gtext-primary border border-glassline backdrop-blur-glass-sm shadow-glass-sm hover:bg-glass-3 hover:border-glassline-hover hover:shadow-glass-md focus-visible:ring-gbrand-ring focus-visible:ring-offset-0',
        'glass-primary':
          'bg-gbrand text-white border border-glassline-brand backdrop-blur-glass-sm shadow-glass-md hover:bg-gbrand-hover hover:shadow-glass-lg focus-visible:ring-gbrand-ring focus-visible:ring-offset-0',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  loadingText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, loadingText, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && <LoadingSpinner size="sm" />}
      {loading && loadingText ? loadingText : children}
    </button>
  ),
);
Button.displayName = 'Button';
