/**
 * 跨页面共享的状态映射（单一事实源）。
 *
 * 收敛动机：同一状态机的 label + tone 此前散落在多个页面各写一份,字节级重复
 * （例如 EmployeeStatus 在 admin/employees 列表页与详情页完全一致）。重复会漂移，
 * 漂移就让"同一个状态在不同页面显示成不同颜色/文案"。这里把**确定无争议**的状态机
 * 收口；有争议的同态异色（如 PAUSED 琥珀 vs 灰、EXPIRED 灰 vs 红、能力类型配色）
 * 属于产品决策，未经确认不在此强行合并。
 *
 * tone 一律用语义令牌（muted / warning / success / danger / fg-*），它们在
 * globals.css 的三套主题作用域里都自动桥接，浅色与暗色玻璃下都满足 AA，
 * 不需要写死 hex，也不需要 dark: 变体。
 */

import type { EmployeeStatus } from '@/lib/types';
import { common } from '@/locales/zh-CN';

/** 状态徽标的统一形状：文案 + 一组语义 class。 */
export interface StatusMeta {
  label: string;
  tone: string;
}

/** 未知/历史状态的安全兜底：中性 pill，不会渲染成空白或 undefined。 */
const FALLBACK_META: StatusMeta = { label: '未知状态', tone: 'bg-muted text-fg-muted' };

/**
 * 硅基员工审核状态（运营端：平台审核内容质量）。
 * 注意 APPROVED 在"员工"语境是**已发布**（上架人才市场），与能力贡献语境的
 * "已收录"含义不同 —— 这是上下文正确的差异，不与其它 APPROVED 合并。
 */
export const EMPLOYEE_STATUS_META: Record<EmployeeStatus, StatusMeta> = {
  DRAFT: { label: '草稿', tone: 'bg-muted text-fg-muted' },
  PENDING: { label: common.status.pendingReview, tone: 'bg-warning/10 text-warning' },
  APPROVED: { label: '已发布', tone: 'bg-success/10 text-success' },
  REJECTED: { label: '已拒绝', tone: 'bg-danger/10 text-danger' },
  ARCHIVED: { label: '已归档', tone: 'bg-muted text-fg-subtle' },
};

/**
 * 按字符串查员工状态映射（API 返回的 status 是不可信字符串，在边界处兜底）。
 * 调用点无需再写 `meta?.tone ?? ''` / `?? status`。
 */
export function employeeStatusMeta(status: string | null | undefined): StatusMeta {
  if (!status) return FALLBACK_META;
  return EMPLOYEE_STATUS_META[status as EmployeeStatus] ?? { ...FALLBACK_META, label: status };
}
