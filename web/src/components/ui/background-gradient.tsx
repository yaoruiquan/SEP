'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface BackgroundGradientProps {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  animate?: boolean;
}

export function BackgroundGradient({
  children,
  className,
  containerClassName,
  animate = true,
}: BackgroundGradientProps) {
  return (
    <div className={cn('group relative', containerClassName)}>
      <div
        className={cn(
          'absolute -inset-[2px] rounded-2xl opacity-60 blur-sm transition-all duration-500 group-hover:opacity-100',
          animate && 'animate-pulse',
          className,
        )}
        style={{
          background:
            'linear-gradient(90deg, #eb3f00, #ff6b2b, #eb3f00, #ff6b2b)',
          backgroundSize: '200% 100%',
          animation: animate
            ? 'gradient-shift 3s ease infinite'
            : undefined,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
