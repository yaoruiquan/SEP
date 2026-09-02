import type { SkillVersionStatus } from '@/lib/types';

export const SKILL_VERSION_STATUS: Record<
  SkillVersionStatus,
  { label: string; className: string }
> = {
  DRAFT: { label: '草稿', className: 'border-glassline bg-glass-2 text-gtext-secondary' },
  // 企业内提审流已下线（会议纪要2 §6.4）。保留映射是为了历史数据仍能渲染出标签，
  // 而不是显示成 undefined —— 但措辞要让人看出这是历史状态，不是等着谁去审。
  PENDING_ENTERPRISE_REVIEW: {
    label: '历史待审',
    className: 'border-glassline bg-glass-2 text-gtext-muted',
  },
  ENTERPRISE_APPROVED: {
    label: '企业已通过',
    className: 'border-gsuccess/30 bg-gsuccess/10 text-gsuccess',
  },
  PENDING_PLATFORM_REVIEW: {
    label: '待平台审核',
    className: 'border-gwarning/30 bg-gwarning/10 text-gwarning',
  },
  PLATFORM_APPROVED: {
    label: '平台已通过',
    className: 'border-gsuccess/30 bg-gsuccess/10 text-gsuccess',
  },
  ENTERPRISE_REJECTED: {
    label: '历史驳回',
    className: 'border-glassline bg-glass-2 text-gtext-muted',
  },
  PLATFORM_REJECTED: {
    label: '平台已驳回',
    className: 'border-gdanger/30 bg-gdanger/10 text-gdanger',
  },
  ARCHIVED: { label: '已归档', className: 'border-glassline bg-glass-1 text-gtext-muted' },
  PERSONAL_ACTIVE: {
    label: '我的副本 · 已生效',
    className: 'border-gsuccess/35 bg-gsuccess/10 text-gsuccess',
  },
};
