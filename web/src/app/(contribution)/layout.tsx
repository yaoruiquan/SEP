import { AuthGate } from '@/components/auth-gate';
import { ContributionRouteShell } from '@/components/shell/contribution-route-shell';

/** 所有已登录用户都可以进入贡献中心；企业页的企业权限仍由原布局保护。 */
export default function ContributionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <ContributionRouteShell>{children}</ContributionRouteShell>
    </AuthGate>
  );
}

