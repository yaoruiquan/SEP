'use client';

import { WalletBalanceCard } from '@/components/wallet/wallet-balance-card';
import { WalletTransactionList } from '@/components/wallet/wallet-transaction-list';

export default function WalletPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">企业钱包</h1>

      <div className="space-y-6">
        <WalletBalanceCard />
        <WalletTransactionList />
      </div>
    </div>
  );
}
