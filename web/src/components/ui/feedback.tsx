import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { Button } from './button';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'text' | 'circular' | 'rectangular';
  lines?: number;
}

/**
 * 增强版骨架屏组件
 */
export function Skeleton({
  variant = 'default',
  lines = 1,
  className,
  ...props
}: SkeletonProps) {
  if (variant === 'text' && lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-4 animate-pulse rounded bg-neutral-200',
              i === lines - 1 ? 'w-3/4' : 'w-full',
              className
            )}
            {...props}
          />
        ))}
      </div>
    );
  }

  const variantClasses = {
    default: 'rounded',
    text: 'h-4 w-full rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  };

  return (
    <div
      className={cn(
        'animate-pulse bg-neutral-200',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}

/**
 * 卡片骨架屏预设
 */
export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" className="h-12 w-12" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton variant="text" lines={2} />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-8 w-16 rounded" />
        <Skeleton className="h-8 w-16 rounded" />
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />;
}

export function CenteredSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-2 text-neutral-500">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?:
    | React.ReactNode
    | {
        label: string;
        onClick: () => void;
        variant?: 'primary' | 'secondary' | 'outline';
      };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      {icon && <div className="text-neutral-400">{icon}</div>}
      <div>
        <p className="font-medium text-neutral-900 text-lg">{title}</p>
        {description && (
          <p className="mt-1.5 text-sm text-neutral-600 max-w-md">{description}</p>
        )}
      </div>
      {action && (
        <>
          {typeof action === 'object' && 'label' in action ? (
            <Button variant={action.variant || 'primary'} onClick={action.onClick}>
              {action.label}
            </Button>
          ) : (
            action
          )}
        </>
      )}
    </div>
  );
}
