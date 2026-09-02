'use client';

import { WalletBalanceCard } from '@/components/wallet/wallet-balance-card';
import { WalletTransactionList } from '@/components/wallet/wallet-transaction-list';

export default function WalletPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">企业钱包</h1>
        <p className="mt-1 text-sm text-gray-600">企业充值与资金流水</p>
      </div>

      <div className="space-y-6">
        <WalletBalanceCard />
        <WalletTransactionList />
      </div>
    </div>
  );
}
