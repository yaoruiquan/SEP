import type { SkillVersionStatus } from '@/lib/types';

export const SKILL_VERSION_STATUS: Record<
  SkillVersionStatus,
  { label: string; className: string }
> = {
  DRAFT: { label: '草稿', className: 'border-glassline bg-glass-2 text-gtext-secondary' },
  PENDING_ENTERPRISE_REVIEW: {
    label: '待企业审核',
    className: 'border-gwarning/30 bg-gwarning/10 text-gwarning',
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
    label: '企业已驳回',
    className: 'border-gdanger/30 bg-gdanger/10 text-gdanger',
  },
  PLATFORM_REJECTED: {
    label: '平台已驳回',
    className: 'border-gdanger/30 bg-gdanger/10 text-gdanger',
  },
  ARCHIVED: { label: '已归档', className: 'border-glassline bg-glass-1 text-gtext-muted' },
};
