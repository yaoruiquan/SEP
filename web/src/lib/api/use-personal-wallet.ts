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

// ============================================================================
// Query Keys
// ============================================================================

export const personalWalletKeys = {
  all: ['personal-wallet'] as const,
  view: () => [...personalWalletKeys.all, 'view'] as const,
  transactions: (filters: PersonalWalletTxFilters) =>
    [...personalWalletKeys.all, 'transactions', filters] as const,
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
 * 个人充值。演示口径：直接入账，没接支付渠道。
 *
 * 成功后连「我的额度」一起失效 —— 成员端把「公司还愿意付多少」和
 * 「我自己还有多少」放在一起看，只刷一半会出现「余额涨了但页面说我没钱」。
 */
export function usePersonalDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountCNY: number) =>
      api.post<PersonalWalletView>('/personal-wallet/deposit', { amountCNY }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: personalWalletKeys.all });
      qc.invalidateQueries({ queryKey: computeCreditKeys.myAllowance() });
    },
  });
}
