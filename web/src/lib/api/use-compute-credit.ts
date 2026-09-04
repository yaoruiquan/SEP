/**
 * 企业算力 API Hooks（统一人民币口径）。
 *
 * 财务口径只有「元」：对话先扣该硅基员工的赠送余额，用尽后扣企业钱包。
 * Token 只作为用量明细展示，不是可购买或可扣减的余额。
 *
 * 所有金额字段都是后端序列化的 Decimal 字符串，渲染前用 formatCny 处理，
 * 不要直接 toFixed —— 字符串上没有这个方法。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';

// ============================================================================
// Types
// ============================================================================

export interface ComputeOverview {
  /** 企业钱包余额（元） */
  walletBalanceCNY: string;
  /**
   * 界面上叫「算力余额」，后端字段叫算力专款 —— 同一个东西，两套词。
   *
   * 用户心智里算力是充值买来的；后端实现上它是钱包余额里贴了
   * 「只能用于与硅基员工对话」标签的一部分，不是第二个账户。
   * 订阅付费动不了它；对话扣费优先消耗它，用尽后仍从自由余额扣，对话不中断。
   */
  computeReservedCNY: string;
  /** 钱包里没被专款占用的部分，订阅等非算力支出只能动这里（元） */
  walletSpendableCNY: string;
  /** 所有在用订阅的剩余赠送余额合计（元） */
  creditRemainingCNY: string;
  /** 钱包 + 赠送，用户视角的「还能对话多少钱」 */
  totalAvailableCNY: string;
  creditGrantedTotalCNY: string;
  creditUsedTotalCNY: string;
  todayConsumeCNY: string;
  monthConsumeCNY: string;
  monthInputTokens: number;
  monthOutputTokens: number;
  totalDepositCNY: string;
  totalConsumeCNY: string;
}

export type CreditStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED';

export interface SubscriptionCreditItem {
  id: string;
  subscriptionId: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar: string | null;
  grantedCNY: string;
  usedCNY: string;
  remainingCNY: string;
  status: CreditStatus | string;
  grantedAt: string;
}

// ── 用量分析（花费分布）────────────────────────────────────────────────────

/** 某个维度上的一行花费分布。 */
export interface BreakdownRow {
  key: string;
  label: string;
  avatar?: string | null;
  /** 次要说明：成员的部门、部门下的人数 */
  hint?: string | null;
  costCNY: string;
  callCount: number;
  /** 占区间总花费的百分比（0–100） */
  pct: number;
}

export type UsageRange = 7 | 30 | 90;

export interface UsageBreakdown {
  rangeDays: number;
  totalCNY: string;
  prevTotalCNY: string;
  /** 环比变化百分比；上期为 0 时为 null */
  deltaPct: number | null;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  trend: Array<{ date: string; costCNY: string }>;
  byModel: BreakdownRow[];
  byDepartment: BreakdownRow[];
  byMember: BreakdownRow[];
  byEmployee: BreakdownRow[];
}

export type AllowancePeriod = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

/** 一位碳基员工的算力分配情况。 */
export interface MemberAllowanceItem {
  userId: string;
  name: string;
  email: string;
  departmentName: string | null;
  /** null = 未分配额度（不限额） */
  limitCNY: string | null;
  period: AllowancePeriod;
  /** 周期的中文名（每月 / 每周 …）。后端给现成的，前端不再维护第二份映射 */
  periodLabel: string;
  /** 未用完的额度是否结转到下一周期（封顶 1 个周期） */
  carryOver: boolean;
  enabled: boolean;
  /** 上一周期结转进来的金额；未开结转时为 "0.00" */
  carriedInCNY: string;
  /**
   * 本周期已消耗的**企业资金**（赠送 + 企业钱包 + 欠费）。
   *
   * 刻意不含成员自付部分：否则「自己掏钱反而更快撞上公司给的上限」，
   * 自费变成自我惩罚。
   */
  usedCNY: string;
  /** 常规额度（上限 + 结转）还剩多少。不限额时为 null */
  remainingCNY: string | null;
  /** 未用完的一次性追加额度合计（跨周期存活，排在常规额度之后消耗） */
  topUpRemainingCNY: string;
  /** 常规 + 追加，本周期还能花的企业资金合计。不限额时为 null */
  totalRemainingCNY: string | null;
  /** 已用占「上限 + 结转」的百分比（0–100）；不限额时为 null */
  usedPct: number | null;
  periodStart: string;
  /** 本周期结束、额度重置的时刻 */
  resetAt: string;
}

/** 一笔追加额度。 */
export interface AllowanceTopUpItem {
  id: string;
  userId: string;
  /** 成员姓名（无名字时回落邮箱）—— 全企业留痕列表里只有 userId 等于不可读 */
  userName: string;
  amountCNY: string;
  consumedCNY: string;
  remainingCNY: string;
  note: string | null;
  grantedByName: string | null;
  createdAt: string;
}

/** 一条额度变更留痕。「为什么他这月只花了 ¥200 就被改道」要靠它回答。 */
export interface AllowanceChangeItem {
  id: string;
  userId: string;
  userName: string;
  fromLimitCNY: string | null;
  toLimitCNY: string | null;
  fromPeriod: AllowancePeriod | null;
  toPeriod: AllowancePeriod | null;
  fromCarryOver: boolean | null;
  toCarryOver: boolean | null;
  /** 变更当时该成员本周期已用多少 —— 没有它就没法解释当时的判定 */
  usedAtChangeCNY: string | null;
  changedByName: string | null;
  note: string | null;
  createdAt: string;
}

export interface UsageRecordItem {
  id: string;
  createdAt: string;
  employeeId: string | null;
  employeeName: string;
  memberId: string | null;
  memberName: string | null;
  sessionId: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** 本次真实成本（元） */
  costCNY: string;
  /** 由赠送余额承担的部分（元） */
  creditPaidCNY: string;
  /** 由企业钱包承担的部分（元） */
  walletPaidCNY: string;
  /**
   * 由成员**个人钱包**承担的部分（元）。
   *
   * 个人钱包排在扣费链最后一位，所以这一列 > 0 只有两种成因：
   * 他本周期的算力额度用尽了，或者企业资金见底了。
   */
  personalPaidCNY: string;
  /** > 0 表示企业资金与个人余额都已耗尽，本次消费有欠费 */
  unpaidCNY: string;
  /** true = 该模型未配价，按保底价计费 */
  fallbackPricing: boolean;
}

export interface UsageRecordsResponse {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  records: UsageRecordItem[];
}

export interface UsageRecordFilters {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  memberId?: string;
  startDate?: string;
  endDate?: string;
}

// ============================================================================
// Query Keys
// ============================================================================

export const computeCreditKeys = {
  all: ['compute-credit'] as const,
  overview: () => [...computeCreditKeys.all, 'overview'] as const,
  credits: () => [...computeCreditKeys.all, 'subscription-credits'] as const,
  credit: (subscriptionId: string) =>
    [...computeCreditKeys.all, 'subscription-credits', subscriptionId] as const,
  allowances: () => [...computeCreditKeys.all, 'allowances'] as const,
  myAllowance: () => [...computeCreditKeys.all, 'my-allowance'] as const,
  topUps: (userId?: string) =>
    [...computeCreditKeys.all, 'allowance-top-ups', userId ?? 'all'] as const,
  changes: (userId?: string) =>
    [...computeCreditKeys.all, 'allowance-changes', userId ?? 'all'] as const,
  breakdown: (days: number) =>
    [...computeCreditKeys.all, 'usage-breakdown', days] as const,
  usage: (filters: UsageRecordFilters) =>
    [...computeCreditKeys.all, 'usage-records', filters] as const,
};

// ============================================================================
// Helpers
// ============================================================================

/** 统一的人民币格式化。后端给的是字符串，Number 化后固定两位小数。 */
export function formatCny(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return `¥${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** 账单明细里的小额金额需要更高精度，否则一整页都是 ¥0.00。 */
export function formatCnyPrecise(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '¥0.00';
  return `¥${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
}

// ============================================================================
// Hooks
// ============================================================================

export interface ComputeReserveResult {
  balance: string;
  computeReservedCNY: string;
  spendableCNY: string;
}

/**
 * 钱包自由余额 ↔ 算力专款 的划转。
 *
 * 成功后必须同时失效 compute-credit 总览与 wallet 余额：两个页面读的是
 * 同一笔钱的两个视角，只刷一边会让用户看到自相矛盾的数字。
 */
function useReserveMutation(path: '/wallet/compute-reserve' | '/wallet/compute-release') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amount: number) =>
      api.post<ComputeReserveResult>(path, { amount }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: computeCreditKeys.overview() });
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

/** 从钱包划入算力专款。 */
export function useReserveForCompute() {
  return useReserveMutation('/wallet/compute-reserve');
}

/** 把算力专款划回钱包自由余额。 */
export function useReleaseFromCompute() {
  return useReserveMutation('/wallet/compute-release');
}

/** 企业算力总览：钱包余额 + 赠送余额 + 消费汇总。 */
export function useComputeOverview() {
  return useQuery({
    queryKey: computeCreditKeys.overview(),
    queryFn: () => api.get<ComputeOverview>('/compute-credit/overview'),
  });
}

/** 各硅基员工的剩余赠送算力余额。 */
export function useSubscriptionCredits() {
  return useQuery({
    queryKey: computeCreditKeys.credits(),
    queryFn: () =>
      api.get<SubscriptionCreditItem[]>('/compute-credit/subscription-credits'),
  });
}

/** 单个订阅的赠送余额（员工详情页）。 */
export function useSubscriptionCredit(subscriptionId: string | undefined) {
  return useQuery({
    queryKey: computeCreditKeys.credit(subscriptionId ?? ''),
    enabled: !!subscriptionId,
    queryFn: () =>
      api.get<{
        subscriptionId: string;
        grantedCNY: string;
        usedCNY: string;
        remainingCNY: string;
        status: string;
      }>(`/compute-credit/subscription-credits/${subscriptionId}`),
  });
}

export const USAGE_RECORDS_PATH = '/compute-credit/usage-records';

/**
 * 筛选条件 → 带 query string 的完整请求路径。
 *
 * hook 与 CSV 导出共用同一个拼装函数：两处各拼一遍，迟早会出现
 * 「界面筛了员工、导出的却是全量」这种对不上的账。
 */
export function buildUsageRecordsUrl(filters: UsageRecordFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.employeeId) params.set('employeeId', filters.employeeId);
  if (filters.memberId) params.set('memberId', filters.memberId);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);

  const query = params.toString();
  return `${USAGE_RECORDS_PATH}${query ? `?${query}` : ''}`;
}

/** 单页拉取账单，供 CSV 导出逐页取全量时复用（不进 react-query 缓存）。 */
export function fetchUsageRecords(
  filters: UsageRecordFilters = {},
): Promise<UsageRecordsResponse> {
  return api.get<UsageRecordsResponse>(buildUsageRecordsUrl(filters));
}

/** 算力用量账单（人民币金额 + Token 明细）。 */
export function useUsageRecords(filters: UsageRecordFilters = {}) {
  return useQuery({
    queryKey: computeCreditKeys.usage(filters),
    queryFn: () => fetchUsageRecords(filters),
  });
}

// ── 算力分配（给碳基员工设本周期上限）──────────────────────────────────────

/** 全体碳基员工的本周期额度与已用金额（仅企业管理员）。 */
export function useMemberAllowances() {
  return useQuery({
    queryKey: computeCreditKeys.allowances(),
    queryFn: () => api.get<MemberAllowanceItem[]>('/compute-credit/allowances'),
  });
}

/**
 * 我自己的额度。成员端自查用，不需要管理员权限。
 *
 * 注意它只回答「公司这个周期还愿意为我付多少」—— 能不能对话还要看个人余额，
 * 两个数字要一起看，见 `usePersonalWallet`。
 */
export function useMyAllowance() {
  return useQuery({
    queryKey: computeCreditKeys.myAllowance(),
    queryFn: () => api.get<MemberAllowanceItem>('/compute-credit/my-allowance'),
  });
}

export interface SetAllowanceVars {
  userId: string;
  /** null = 取消限额（不限额） */
  limitCNY: number | null;
  period?: AllowancePeriod;
  carryOver?: boolean;
  note?: string;
}

/**
 * 给某位成员分配额度。`limitCNY: null` = 取消限额。
 *
 * 成功后要连总览一起失效：分配本身不动余额，但页面上两处都会显示
 * 「已分配几人」这类派生数字，只刷一边会不一致。变更留痕也要刷 ——
 * 保存完看不到自己刚做的那条改动，会让人怀疑没保存成功。
 */
export function useSetMemberAllowance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: SetAllowanceVars) =>
      api.put<MemberAllowanceItem>(`/compute-credit/allowances/${userId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: computeCreditKeys.allowances() });
      qc.invalidateQueries({ queryKey: computeCreditKeys.myAllowance() });
      qc.invalidateQueries({ queryKey: computeCreditKeys.overview() });
      qc.invalidateQueries({ queryKey: [...computeCreditKeys.all, 'allowance-changes'] });
    },
  });
}

/**
 * 追加一次性额度。与「调高上限」是两回事：追加额度跨周期存活，
 * 且排在常规额度之后消耗 —— 用途是「他这个月要多干点活」，
 * 不是「他以后每期都能花更多」。
 */
export function useTopUpMemberAllowance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      ...body
    }: {
      userId: string;
      amountCNY: number;
      note?: string;
    }) =>
      api.post<MemberAllowanceItem>(
        `/compute-credit/allowances/${userId}/top-up`,
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: computeCreditKeys.allowances() });
      qc.invalidateQueries({ queryKey: computeCreditKeys.myAllowance() });
      qc.invalidateQueries({ queryKey: [...computeCreditKeys.all, 'allowance-top-ups'] });
    },
  });
}

/**
 * 追加额度记录（最近 50 条）。传 userId 只看某位成员。
 *
 * `enabled` 不是可选的性能优化：这两个 hook 会挂在**每一行成员**的弹窗里，
 * 不关掉就是开一次页面打 N 次请求。
 */
export function useAllowanceTopUps(userId?: string, enabled = true) {
  return useQuery({
    queryKey: computeCreditKeys.topUps(userId),
    enabled,
    queryFn: () =>
      api.get<AllowanceTopUpItem[]>(
        `/compute-credit/allowance-top-ups${userId ? `?userId=${userId}` : ''}`,
      ),
  });
}

/** 额度变更留痕（最近 50 条）。传 userId 只看某位成员。 */
export function useAllowanceChanges(userId?: string, enabled = true) {
  return useQuery({
    queryKey: computeCreditKeys.changes(userId),
    enabled,
    queryFn: () =>
      api.get<AllowanceChangeItem[]>(
        `/compute-credit/allowance-changes${userId ? `?userId=${userId}` : ''}`,
      ),
  });
}

/**
 * 花费分布。四个维度一次拿回来 —— 分开打接口会让这一页发五次请求，
 * 而且各维度的时间区间还得前端自己对齐。
 */
export function useUsageBreakdown(days: UsageRange = 30) {
  return useQuery({
    queryKey: computeCreditKeys.breakdown(days),
    queryFn: () =>
      api.get<UsageBreakdown>(`/compute-credit/usage-breakdown?days=${days}`),
  });
}
