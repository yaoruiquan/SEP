import { Suspense } from 'react';
import { CenteredSpinner } from '@/components/ui/feedback';
import { AccountClosureFlow } from '@/features/auth/account-closure-flow';

export default function AccountClosurePage() {
  return <Suspense fallback={<CenteredSpinner label="加载中…" />}><AccountClosureFlow /></Suspense>;
}
