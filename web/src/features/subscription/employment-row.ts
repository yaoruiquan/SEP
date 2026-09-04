import type { Subscription } from '@/lib/types';

/**
 * 雇佣管理列表的行模型。
 *
 * 这一层单独存在的理由：「这段雇佣关系有没有需要我处理的事」是**判断**，
 * 不是渲染。判断散在 JSX 里就没法测，也没法保证顶部汇总条和行内标记用的是
 * 同一套口径 —— 汇总说「1 个没授权」而列表标出 2 行，是最典型的走样。
 */

/** 一段雇佣关系上待处理的事，按严重度从高到低。 */
export type AttentionKind =
  /** 雇了，但没授权给任何人 —— 花了钱一个人也用不上 */
  | 'NO_GRANT'
  /** 授权了，但近 30 天没有任何人用过 */
  | 'UNUSED'
  /** 已暂停：授权还在，但谁都用不了 */
  | 'PAUSED'
  /** 模板出了新版本，本企业还锁在旧版 */
  | 'UPGRADABLE'
  /** 赠送算力已用尽，后续从企业钱包扣 */
  | 'GIFT_EXHAUSTED';

export interface AttentionMeta {
  kind: AttentionKind;
  /** 行内短标签 */
  label: string;
  /** 汇总条上的说法，含数量占位 */
  summary: (count: number) => string;
  tone: 'danger' | 'warning' | 'info';
}

/**
 * 严重度顺序即数组顺序。行内只显示最严重的那一条 ——
 * 一行同时挂 4 个徽章等于没有重点。
 */
export const ATTENTION_ORDER: readonly AttentionMeta[] = [
  {
    kind: 'NO_GRANT',
    label: '没授权给任何人',
    summary: (n) => `${n} 个没授权给任何人`,
    tone: 'danger',
  },
  {
    kind: 'PAUSED',
    label: '已暂停',
    summary: (n) => `${n} 个已暂停`,
    tone: 'warning',
  },
  {
    kind: 'UNUSED',
    label: '近 30 天没人用',
    summary: (n) => `${n} 个雇了没人用`,
    tone: 'warning',
  },
  {
    kind: 'UPGRADABLE',
    label: '可升级',
    summary: (n) => `${n} 个可升级`,
    tone: 'info',
  },
  {
    kind: 'GIFT_EXHAUSTED',
    label: '赠送算力已用尽',
    summary: (n) => `${n} 个赠送算力已用尽`,
    tone: 'info',
  },
];

const META_BY_KIND = new Map(ATTENTION_ORDER.map((meta) => [meta.kind, meta]));

/**
 * 刚雇进来的宽限期（天）。
 *
 * 「近 30 天没人用」对一段只存在了 3 天的雇佣关系是无意义的指控 —— 分母还没长够。
 * 实测演示租户 19 段雇佣里 16 段都是 7 天前刚建的，不设宽限期这一栏会报
 * 「16 个近 30 天没人用」，把真正该处理的那一个（没授权给任何人）盖掉。
 * 两周足够走完开通与试用。
 */
const ONBOARDING_GRACE_DAYS = 14;

function daysSince(iso: string, now: number): number {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return (now - at) / 86_400_000;
}

export function attentionMeta(kind: AttentionKind): AttentionMeta {
  return META_BY_KIND.get(kind)!;
}

export interface EmploymentRow {
  subscription: Subscription;
  /** 该行全部待处理项，已按严重度排序 */
  attention: AttentionKind[];
  /** 最严重的一项，没有则为 null */
  primaryAttention: AttentionKind | null;
  /** 终态：已解聘，所有管理动作都该禁掉而不是让后端报 409 */
  dismissed: boolean;
}

export function buildEmploymentRow(
  subscription: Subscription,
  /** 注入当前时间便于测试；默认取实时 */
  now: number = Date.now(),
): EmploymentRow {
  const dismissed = subscription.status === 'EXPIRED';
  const usage = subscription.usage;
  const attention: AttentionKind[] = [];

  // 已解聘的不再提任何待办 —— 它已经不花钱、也不该被「授权」了。
  if (!dismissed) {
    // usage 缺失时不猜：聚合没回来就说明「不知道」，报成「没授权」会造出假待办。
    if (usage && usage.grantedUserCount === 0) attention.push('NO_GRANT');
    if (subscription.status === 'PAUSED') attention.push('PAUSED');
    // 有授权但没人用才算「白雇着」。没授权的已经报 NO_GRANT 了，
    // 再补一条「没人用」是同一件事说两遍。
    if (
      usage &&
      usage.grantedUserCount > 0 &&
      usage.activeUserCount30d === 0 &&
      daysSince(subscription.startDate, now) >= ONBOARDING_GRACE_DAYS
    ) {
      attention.push('UNUSED');
    }
    if (subscription.upgradeAvailable) attention.push('UPGRADABLE');
    if (subscription.giftStatus === 'EXHAUSTED') attention.push('GIFT_EXHAUSTED');
  }

  const ordered = ATTENTION_ORDER.filter((meta) => attention.includes(meta.kind)).map(
    (meta) => meta.kind,
  );

  return {
    subscription,
    attention: ordered,
    primaryAttention: ordered[0] ?? null,
    dismissed,
  };
}

/** 汇总条：每种待处理项各有多少个。只保留计数 > 0 的，顺序同 ATTENTION_ORDER。 */
export function summarizeAttention(
  rows: readonly EmploymentRow[],
): Array<{ meta: AttentionMeta; count: number }> {
  return ATTENTION_ORDER.map((meta) => ({
    meta,
    // 汇总数的是「有这个问题的行」，不是「以这个问题为主的行」——
    // 一个既没授权又可升级的员工，在两栏里都该被数到，否则「2 个可升级」
    // 点进去只有 1 行，用户会以为筛选坏了。
    count: rows.filter((row) => row.attention.includes(meta.kind)).length,
  })).filter((item) => item.count > 0);
}

/** 授权去向的一句话说明：「2 部门 · 3 人」/「未授权」。 */
export function describeGrantShape(subscription: Subscription): string {
  const usage = subscription.usage;
  if (!usage) return '—';
  if (usage.grantedUserCount === 0) return '未授权';
  const parts: string[] = [];
  if (usage.grantedDepartmentCount > 0) parts.push(`${usage.grantedDepartmentCount} 个部门`);
  if (usage.grantedMemberCount > 0) parts.push(`${usage.grantedMemberCount} 人单独`);
  return parts.join(' · ') || '未授权';
}
