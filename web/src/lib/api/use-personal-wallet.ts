/**
 * 个人钱包 API Hooks（成员自己的钱）。
 *
 * 与企业钱包 (`./wallet.ts`) 是两套完全独立的账：
 *   · 企业钱包由管理员充值，付订阅、付全公司的对话
 *   · 个人钱包由成员自己充值，只在**企业不再为他付这一笔**时才被动用
 *
 * 扣费链上个人钱包排在最后一位（赠送 → 企业钱包 → 个人钱包 → 欠费），
 * 所以这里的余额下降只有两种成因：他本周期的算力额度用尽了，
 * 或者企业资金见底了。
 *
 * 所有接口都只作用于当前登录用户 —— 后端不接受 userId 参数，
 * 前端也不要试图传。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { computeCreditKeys } from './use-compute-credit';

// ============================================================================
// Types
// ============================================================================

/** 个人钱包概览。金额都是后端序列化的 Decimal 字符串。 */
export interface PersonalWalletView {
  balanceCNY: string;
  totalDepositCNY: string;
  totalConsumeCNY: string;
}

export type PersonalWalletTxType = 'DEPOSIT' | 'CONSUME' | 'REFUND' | 'ADJUSTMENT';

export interface PersonalWalletTransaction {
  id: string;
  type: PersonalWalletTxType | string;
  /** 正数 = 入账，负数 = 出账。渲染时按符号选颜色，不要取绝对值 */
  amountCNY: string;
  balanceAfterCNY: string;
  description: string | null;
  /** 'compute' = 对话消费，'recharge_order' = 充值单 */
  relatedType: string | null;
  relatedId: string | null;
  createdAt: string;
}

export interface PersonalWalletTransactionPage {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  records: PersonalWalletTransaction[];
}

export interface PersonalWalletTxFilters {
  page?: number;
  pageSize?: number;
}

/** 下单结果。`payUrl` 是支付宝的 GET 支付页地址，直接跳过去。 */
export interface PersonalRechargeOrderCreated {
  orderId: string;
  orderNo: string;
  amountCNY: string;
  payUrl: string;
}

export interface PersonalRechargeOrder {
  orderNo: string;
  amountCNY: string;
  status: 'PENDING' | 'PAID' | 'CLOSED';
  payChannel: string | null;
  paidAt: string | null;
  createdAt: string;
}

// ============================================================================
// Query Keys
// ============================================================================

export const personalWalletKeys = {
  all: ['personal-wallet'] as const,
  view: () => [...personalWalletKeys.all, 'view'] as const,
  transactions: (filters: PersonalWalletTxFilters) =>
    [...personalWalletKeys.all, 'transactions', filters] as const,
  rechargeOrder: (orderNo: string | null) =>
    [...personalWalletKeys.all, 'recharge-order', orderNo] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/** 我的个人余额。 */
export function usePersonalWallet() {
  return useQuery({
    queryKey: personalWalletKeys.view(),
    queryFn: () => api.get<PersonalWalletView>('/personal-wallet'),
  });
}

/**
 * 我的个人钱包流水（充值 + 自费消费）。
 *
 * `enabled` 给「折叠起来的流水列表」用：面板默认收起，展开前不该为了一份
 * 看不见的列表打一次请求。
 */
export function usePersonalWalletTransactions(
  filters: PersonalWalletTxFilters = {},
  enabled = true,
) {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const query = params.toString();

  return useQuery({
    queryKey: personalWalletKeys.transactions(filters),
    enabled,
    queryFn: () =>
      api.get<PersonalWalletTransactionPage>(
        `/personal-wallet/transactions${query ? `?${query}` : ''}`,
      ),
  });
}

/**
 * 个人充值下单。
 *
 * **不返回余额** —— 它只创建一张 PENDING 订单并拿到支付宝支付地址。
 * 余额要等支付宝的异步通知（或结果页的对账）到达后才会变，所以这里
 * 没有 `onSuccess` 里的缓存失效：那时候刷新只会读到没变的旧余额。
 *
 * 曾经这里是 `POST /personal-wallet/deposit`，点一下就直接加余额 ——
 * 成员可以零成本给自己发算力。那个接口已经从后端删掉了。
 */
export function useCreatePersonalRecharge() {
  return useMutation({
    mutationFn: (amountCNY: number) =>
      api.post<PersonalRechargeOrderCreated>('/personal-wallet/recharge', {
        amountCNY,
      }),
  });
}

/** 我的充值订单状态。PENDING 时每 2 秒轮一次，落终态自动停。 */
export function usePersonalRechargeOrder(orderNo: string | null) {
  return useQuery({
    queryKey: personalWalletKeys.rechargeOrder(orderNo),
    enabled: !!orderNo,
    queryFn: () =>
      api.get<PersonalRechargeOrder>(
        `/personal-wallet/recharge/${encodeURIComponent(orderNo!)}`,
      ),
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' ? 2000 : false,
  });
}

/**
 * 主动向支付宝核对（兜底）。
 *
 * 异步通知会丢（回调地址错配、服务重启、网络抖动），只轮询本地状态会永远
 * 停在 PENDING —— 用户看到的是「钱付了、余额没动」。结果页每隔几秒调它一次。
 *
 * 补履约成功后连「我的额度」一起失效：成员端把「公司还愿意付多少」和
 * 「我自己还有多少」放在一起看，只刷一半会出现自相矛盾的两个数字。
 */
export function useReconcilePersonalRecharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderNo: string) =>
      api.post<{ status: string; reconciled: boolean }>(
        `/personal-wallet/recharge/${encodeURIComponent(orderNo)}/reconcile`,
        {},
      ),
    onSuccess: (result, orderNo) => {
      if (!result.reconciled) return;
      qc.invalidateQueries({
        queryKey: personalWalletKeys.rechargeOrder(orderNo),
      });
      qc.invalidateQueries({ queryKey: personalWalletKeys.all });
      qc.invalidateQueries({ queryKey: computeCreditKeys.myAllowance() });
    },
  });
}
