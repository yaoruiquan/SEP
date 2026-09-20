/**
 * AnimatedCard Component - Card with hover animations using framer-motion
 */

'use client';

import { motion, HTMLMotionProps } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface AnimatedCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: React.ReactNode;
  className?: string;
  hoverScale?: number;
  hoverY?: number;
}

export function AnimatedCard({
  children,
  className,
  hoverScale = 1.01,
  hoverY = -4,
  ...props
}: AnimatedCardProps) {
  return (
    <motion.div
      whileHover={{ y: hoverY, scale: hoverScale }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      {...props}
    >
      <Card className={cn('transition-shadow hover:shadow-lg', className)}>
        {children}
      </Card>
    </motion.div>
  );
}
