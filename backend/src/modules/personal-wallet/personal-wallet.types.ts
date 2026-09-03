/** 个人钱包概览（成员端「我的余额」）。金额一律元，Decimal 序列化为字符串。 */
export interface PersonalWalletView {
  balanceCNY: string;
  totalDepositCNY: string;
  totalConsumeCNY: string;
}

export interface PersonalWalletTransactionView {
  id: string;
  type: string;
  /** 正数=入账，负数=出账 */
  amountCNY: string;
  balanceAfterCNY: string;
  description: string | null;
  relatedType: string | null;
  relatedId: string | null;
  createdAt: Date;
}

export interface PersonalWalletTransactionPage {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  records: PersonalWalletTransactionView[];
}

/** 一次个人钱包扣款的结果。与 WalletService.consumeComputeUpTo 同形，扣费链才能统一处理。 */
export interface PersonalConsumeResult {
  transactionId: string | null;
  paid: import('@prisma/client/runtime/library').Decimal;
  unpaid: import('@prisma/client/runtime/library').Decimal;
}
