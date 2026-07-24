import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Map capability type enum → human label + tone for tag rendering. */
export const CAPABILITY_TYPE_META: Record<
  string,
  { label: string; tone: string }
> = {
  AGENT: { label: 'Agent 智能体', tone: 'bg-[#eef2ff] text-[#4338ca]' },
  RPA: { label: 'RPA 流程自动化', tone: 'bg-[#ecfdf5] text-[#047857]' },
  SKILL: { label: 'Skill 技能', tone: 'bg-[#fff1ec] text-[#c43500]' },
  AI_APP: { label: 'AI 应用', tone: 'bg-[#fef3c7] text-[#b45309]' },
};

export const SUBSCRIPTION_STATUS_META: Record<
  string,
  { label: string; tone: string }
> = {
  ACTIVE: { label: '使用中', tone: 'text-success' },
  PAUSED: { label: '已暂停', tone: 'text-warning' },
  EXPIRED: { label: '已过期', tone: 'text-fg-subtle' },
};
