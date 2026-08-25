import type {
  ContributionCapability,
  ContributionPlatformStatus,
  ContributionReviewStatus,
} from '@/lib/types';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

export const TYPE_META = {
  AGENT: { label: 'Agent', icon: 'bot' },
  SKILL: { label: 'Skill', icon: 'sparkles' },
  RPA: { label: 'RPA', icon: 'workflow' },
  AI_APP: { label: 'AI App', icon: 'app' },
} as const;

export const REVIEW_META: Record<ContributionReviewStatus, { label: string; tone: StatusTone }> = {
  NOT_SUBMITTED: { label: '未提交', tone: 'muted' },
  PENDING: { label: '审核中', tone: 'warning' },
  APPROVED: { label: '已通过', tone: 'success' },
  REJECTED: { label: '已驳回', tone: 'danger' },
};

export const PLATFORM_META: Record<ContributionPlatformStatus, { label: string; tone: StatusTone }> = {
  NOT_SUBMITTED: { label: '未申请', tone: 'muted' },
  REQUESTED: { label: '待企业授权', tone: 'warning' },
  PENDING_REVIEW: { label: '平台审核中', tone: 'warning' },
  APPROVED: { label: '已上架市场', tone: 'success' },
  REJECTED: { label: '平台驳回', tone: 'danger' },
};

export function currentContributionState(item: ContributionCapability) {
  if (item.platformReviewStatus === 'APPROVED') return { label: '已上架市场', tone: 'success' as const };
  if (item.platformReviewStatus === 'PENDING_REVIEW') return { label: '平台审核中', tone: 'warning' as const };
  if (item.platformReviewStatus === 'REQUESTED') return { label: '待企业授权', tone: 'warning' as const };
  if (item.platformReviewStatus === 'REJECTED') return { label: '平台驳回', tone: 'danger' as const };
  if (item.enterpriseReviewStatus === 'PENDING') return { label: '企业审核中', tone: 'warning' as const };
  if (item.enterpriseReviewStatus === 'REJECTED') return { label: '企业驳回', tone: 'danger' as const };
  if (item.enterpriseReviewStatus === 'APPROVED') return { label: '企业已通过', tone: 'success' as const };
  return { label: '草稿', tone: 'muted' as const };
}

export const toneClasses: Record<StatusTone, string> = {
  success: 'border-gsuccess/40 bg-gsuccess/15 text-gsuccess',
  warning: 'border-gwarning/40 bg-gwarning/15 text-gwarning',
  danger: 'border-gdanger/40 bg-gdanger/15 text-gdanger',
  info: 'border-ginfo/40 bg-ginfo/15 text-ginfo',
  muted: 'border-glassline bg-glass-2 text-gtext-muted',
};
