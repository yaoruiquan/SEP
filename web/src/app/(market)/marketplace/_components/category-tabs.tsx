'use client';

import { cn } from '@/lib/utils';
import { EMPLOYEE_CATEGORIES } from '@/lib/employee-categories';

const TABS = [
  { label: '全部',  value: '' },
  { label: '热门',  value: '__hot__' },
  { label: '新上架', value: '__new__' },
  ...EMPLOYEE_CATEGORIES,
];

interface CategoryTabsProps {
  active: string;
  onChange: (v: string) => void;
}

export function CategoryTabs({ active, onChange }: CategoryTabsProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide" role="tablist">
      {TABS.map((tab) => {
        const isActive = active === tab.value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              'shrink-0 rounded-t-glass-md border-b-2 px-4 py-2 text-[13px] font-medium',
              'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gbrand/50',
              isActive
                ? 'border-[#818cf8] bg-[rgba(129,140,248,0.12)] text-[#818cf8]'
                : 'border-transparent text-gtext-secondary hover:bg-glass-2 hover:text-gtext-primary',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
