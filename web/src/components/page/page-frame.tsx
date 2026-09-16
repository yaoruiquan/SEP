import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function PageFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-[1440px] space-y-6 pb-8', className)} {...props} />;
}
