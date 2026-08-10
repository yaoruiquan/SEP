import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { instanceStatus, subscriptionStatus } from '@/locales/zh-CN';

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
  ACTIVE: { label: subscriptionStatus.ACTIVE, tone: 'text-success' },
  PAUSED: { label: subscriptionStatus.PAUSED, tone: 'text-warning' },
  EXPIRED: { label: subscriptionStatus.EXPIRED, tone: 'text-fg-subtle' },
};

/**
 * 员工实例状态（代码层枚举仍为 InstanceStatus，不改动）。
 * REVOKED 是终态，不可转回。文案来源见 locales/zh-CN.ts。
 */
export const INSTANCE_STATUS_LABEL = instanceStatus;

export const INSTANCE_STATUS_STYLE: Record<string, string> = {
  PENDING_ACTIVATION: 'bg-warning/10 text-warning',
  ACTIVE: 'bg-success/10 text-success',
  SUSPENDED: 'bg-muted text-fg-muted',
  REVOKED: 'bg-danger/10 text-danger',
};
