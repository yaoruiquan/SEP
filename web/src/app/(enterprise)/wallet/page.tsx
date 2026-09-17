'use client';

import { WalletBalanceCard } from '@/components/wallet/wallet-balance-card';
import { WalletTransactionList } from '@/components/wallet/wallet-transaction-list';

export default function WalletPage() {
  return (
    <div className="space-y-6 pb-10">
      <div className="border-b border-border/70 pb-4">
        <h1 className="text-2xl font-semibold text-foreground">企业钱包</h1>
        <p className="mt-1 text-sm text-fg-muted">企业充值、算力专款与资金流水</p>
      </div>

      <WalletBalanceCard />
      <WalletTransactionList />
    </div>
  );
}
