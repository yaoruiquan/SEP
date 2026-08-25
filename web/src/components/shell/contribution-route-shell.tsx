'use client';

import { useAuthStore } from '@/lib/auth-store';
import { ContributorShell } from './contributor-shell';
import { EnterpriseShell } from './enterprise-shell';

/** 企业用户保留完整企业导航，无企业用户使用贡献者专用导航。 */
export function ContributionRouteShell({ children }: { children: React.ReactNode }) {
  const enterprise = useAuthStore((state) => state.enterprise);
  return enterprise ? (
    <EnterpriseShell>{children}</EnterpriseShell>
  ) : (
    <ContributorShell>{children}</ContributorShell>
  );
}

