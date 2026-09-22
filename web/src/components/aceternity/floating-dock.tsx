'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';

export const FloatingDock = ({
  items,
  mobileClassName,
}: {
  items: { title: string; icon: React.ReactNode; href: string }[];
  mobileClassName?: string;
}) => {
  return <FloatingDockMobile items={items} className={mobileClassName} />;
};

const FloatingDockMobile = ({
  items,
  className,
}: {
  items: { title: string; icon: React.ReactNode; href: string }[];
  className?: string;
}) => {
  return (
    <div className={cn('fixed bottom-4 inset-x-0 z-50 flex justify-center md:hidden', className)}>
      <div className="glass-card flex h-14 gap-2 rounded-full border border-glassline px-4 shadow-glow-brand backdrop-blur-glass-md">
        {items.map((item, idx) => (
          <Link
            key={idx}
            href={item.href}
            className="flex h-14 w-14 items-center justify-center transition-colors hover:text-gbrand-text"
            title={item.title}
          >
            <div className="h-5 w-5 text-gtext-primary [&>svg]:h-5 [&>svg]:w-5">{item.icon}</div>
          </Link>
        ))}
      </div>
    </div>
  );
};
