'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export const BackgroundGradient = ({
  children,
  className,
  containerClassName,
  animate = true,
}: {
  children?: React.ReactNode;
  className?: string;
  containerClassName?: string;
  animate?: boolean;
}) => {
  const variants = {
    initial: {
      backgroundPosition: '0 50%',
    },
    animate: {
      backgroundPosition: ['0, 50%', '100% 50%', '0 50%'],
    },
  };
  return (
    <div className={cn('group relative', containerClassName)}>
      <motion.div
        variants={animate ? variants : undefined}
        initial={animate ? 'initial' : undefined}
        animate={animate ? 'animate' : undefined}
        transition={
          animate
            ? {
                duration: 5,
                repeat: Infinity,
                repeatType: 'reverse',
              }
            : undefined
        }
        style={{
          backgroundSize: animate ? '400% 400%' : undefined,
        }}
        className={cn(
          'absolute inset-0 z-[1] rounded-glass-lg opacity-60 blur-xl transition duration-500 will-change-transform group-hover:opacity-100',
          'bg-[radial-gradient(circle_farthest-side_at_0_100%,var(--color-gbrand),transparent),radial-gradient(circle_farthest-side_at_100%_0,var(--color-gbrand-hover),transparent),radial-gradient(circle_farthest-side_at_100%_100%,var(--color-gbrand),transparent),radial-gradient(circle_farthest-side_at_0_0,var(--color-gbrand-text),var(--color-glass-1))]',
        )}
      />
      <motion.div className={cn('relative z-10', className)}>{children}</motion.div>
    </div>
  );
};
