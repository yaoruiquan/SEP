import type {
  ContributionCapability,
  ContributionPlatformStatus,
  ContributionReviewStatus,
} from '@/lib/types';
import type { ActorKind, StageState } from './pipeline-model';

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
  // 「已上架市场」是句做不到的话 —— 平台没有能力市场页面，公共能力的去处是
  // 「可以被绑定到硅基员工」，用户最终在员工市场里买到的是带这个能力的员工。
  APPROVED: { label: '已收录为公共能力', tone: 'success' },
  REJECTED: { label: '平台驳回', tone: 'danger' },
};

export function currentContributionState(item: ContributionCapability) {
  if (item.platformReviewStatus === 'APPROVED') return { label: '已收录为公共能力', tone: 'success' as const };
  if (item.platformReviewStatus === 'PENDING_REVIEW') return { label: '平台审核中', tone: 'warning' as const };
  if (item.platformReviewStatus === 'REQUESTED') return { label: '待企业授权', tone: 'warning' as const };
  if (item.platformReviewStatus === 'REJECTED') return { label: '平台驳回', tone: 'danger' as const };
  if (item.enterpriseReviewStatus === 'PENDING') return { label: '企业审核中', tone: 'warning' as const };
  if (item.enterpriseReviewStatus === 'REJECTED') return { label: '企业驳回', tone: 'danger' as const };
  if (item.enterpriseReviewStatus === 'APPROVED') return { label: '企业已通过', tone: 'success' as const };
  return { label: '草稿', tone: 'muted' as const };
}

// 低饱和：填充从 /15 降到 /10，描边从 /40 降到 /28。
// 状态徽章在列表里会同时出现十几个，高饱和填充会盖过页面主 CTA。
export const toneClasses: Record<StatusTone, string> = {
  success: 'border-gsuccess/28 bg-gsuccess/10 text-gsuccess',
  warning: 'border-gwarning/28 bg-gwarning/10 text-gwarning',
  danger: 'border-gdanger/28 bg-gdanger/10 text-gdanger',
  info: 'border-ginfo/28 bg-ginfo/10 text-ginfo',
  muted: 'border-glassline bg-glass-2 text-gtext-muted',
};

/** 流程节点专用配色。active 用品牌色是唯一例外——当前步骤需要成为视觉锚点。 */
export const stageToneClasses: Record<StageState, string> = {
  done: 'border-gsuccess/25 bg-gsuccess/[0.08] text-gsuccess',
  active: 'border-glassline-brand bg-gbrand/10 text-gbrand-text',
  waiting: 'border-glassline bg-glass-1 text-gtext-muted',
  blocked: 'border-gdanger/25 bg-gdanger/[0.08] text-gdanger',
};

export const stageStateLabel: Record<StageState, string> = {
  done: '完成',
  active: '进行中',
  waiting: '未开始',
  blocked: '需处理',
};

/** 经办人图标标识。系统/市场用中性图标，只有真实的人才配拟人图标。 */
export const ACTOR_META: Record<ActorKind, { icon: 'user' | 'shield' | 'gavel' | 'cpu' | 'store'; humanized: boolean }> = {
  contributor: { icon: 'user', humanized: true },
  'enterprise-admin': { icon: 'shield', humanized: true },
  'platform-ops': { icon: 'gavel', humanized: true },
  system: { icon: 'cpu', humanized: false },
  market: { icon: 'store', humanized: false },
};
