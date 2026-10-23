import { Suspense } from 'react';
import { CenteredSpinner } from '@/components/ui/feedback';
import { AccountClosureCancelFlow } from '@/features/auth/account-closure-flow';

export default function AccountClosureCancelPage() {
  return <Suspense fallback={<CenteredSpinner label="加载中…" />}><AccountClosureCancelFlow /></Suspense>;
}
