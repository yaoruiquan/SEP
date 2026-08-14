'use client';

import { AtSign } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface SwitchableEmployee {
  id: string;
  name: string;
  avatar: string | null;
  position?: string;
}

interface EmployeeSwitcherProps {
  employees: SwitchableEmployee[];
  activeId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

/**
 * 会话内的员工路由选择器。
 *
 * 只显示头像、仅选中项展开名字：一个会话可能授权了十几位员工，
 * 每项都平铺名字会挤满整行并迫使横向滚动，反而看不清有谁。
 */
export function EmployeeSwitcher({
  employees,
  activeId,
  onSelect,
  disabled,
}: EmployeeSwitcherProps) {
  // 无从切换时不占视觉空间
  if (employees.length < 2) return null;

  const active = employees.find((e) => e.id === activeId);

  return (
    <div className="mb-2 flex items-center gap-2">
      <div className="flex shrink-0 items-center gap-1 text-xs text-fg-subtle">
        <AtSign className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">指定回复</span>
      </div>

      <div
        role="radiogroup"
        aria-label="选择回复本条消息的员工"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-thin pb-0.5"
      >
        {employees.map((emp) => {
          const isActive = emp.id === activeId;
          return (
            <button
              key={emp.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={disabled}
              onClick={() => onSelect(emp.id)}
              title={emp.position ? `${emp.name} · ${emp.position}` : emp.name}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 rounded-full border py-1 transition-all',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isActive
                  ? 'border-primary/40 bg-primary-subtle pl-1 pr-2.5 shadow-sm ring-2 ring-brand-ring'
                  : 'border-transparent px-1 hover:border-border hover:bg-muted',
              )}
            >
              <Avatar
                name={emp.name}
                src={emp.avatar ?? undefined}
                className={cn(
                  'h-7 w-7 text-xs transition-opacity',
                  !isActive && 'opacity-70 group-hover:opacity-100',
                )}
              />
              {isActive && (
                <span className="max-w-[10rem] truncate text-xs font-medium text-primary">
                  {emp.name}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active?.position && (
        <span className="hidden shrink-0 truncate text-xs text-fg-subtle md:inline">
          {active.position}
        </span>
      )}
    </div>
  );
}
