import type { SkillVersionScope } from '@/lib/types';

/** 缺少来源字段时只标个人提交，不根据状态或名称猜测客户端来源。 */
export function personalSourceLabel(version: { isWorkingCopy?: boolean }): string {
  if (version.isWorkingCopy === true) return '历史 Web 副本';
  if (version.isWorkingCopy === false) return '客户端提交';
  return '个人提交';
}

export function skillVersionLabel(version: { scope: SkillVersionScope; version: string; isWorkingCopy?: boolean }): string {
  const source = version.scope === 'PERSONAL' ? personalSourceLabel(version)
    : version.scope === 'ENTERPRISE' ? '企业版' : '平台版';
  return `${source} ${version.version}`;
}
