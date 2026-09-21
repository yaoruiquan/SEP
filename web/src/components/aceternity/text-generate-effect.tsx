'use client';

import { useEffect, useState } from 'react';
import { motion, stagger, useAnimate } from 'framer-motion';
import { cn } from '@/lib/utils';

export const TextGenerateEffect = ({
  words,
  className,
  filter = true,
  duration = 0.5,
}: {
  words: string;
  className?: string;
  filter?: boolean;
  duration?: number;
}) => {
  const [scope, animate] = useAnimate();
  const [isComplete, setIsComplete] = useState(false);
  const wordsArray = words.split(' ');

  useEffect(() => {
    if (!scope.current) return;

    animate(
      'span',
      {
        opacity: 1,
        filter: filter ? 'blur(0px)' : 'none',
      },
      {
        duration: duration,
        delay: stagger(0.05),
      },
    ).then(() => setIsComplete(true));
  }, [scope, animate, filter, duration]);

  const renderWords = () => {
    return (
      <motion.div ref={scope}>
        {wordsArray.map((word, idx) => (
          <motion.span
            key={word + idx}
            className={cn(
              'inline-block opacity-0',
              filter && 'blur-sm',
            )}
            style={{
              filter: filter ? 'blur(10px)' : 'none',
            }}
          >
            {word}{' '}
          </motion.span>
        ))}
      </motion.div>
    );
  };

  return (
    <div className={cn('font-normal', className)}>
      {renderWords()}
    </div>
  );
};
