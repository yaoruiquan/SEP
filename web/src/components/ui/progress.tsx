/**
 * Progress Component - Enhanced progress bar with variants
 */

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value?: number;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'brand';
  showValue?: boolean;
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value = 0, variant = 'default', showValue = false, ...props }, ref) => {
  const variantClasses = {
    default: 'bg-brand-500',
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
    brand: 'bg-brand-600',
  };

  return (
    <div className="relative w-full">
      <ProgressPrimitive.Root
        ref={ref}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-gray-200',
          className
        )}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full transition-all duration-300 ease-in-out',
            variantClasses[variant]
          )}
          style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
        />
      </ProgressPrimitive.Root>

      {showValue && (
        <span className="absolute right-0 top-0 -mt-5 text-xs font-medium text-gray-600">
          {value}%
        </span>
      )}
    </div>
  );
});

Progress.displayName = 'Progress';

export { Progress };
