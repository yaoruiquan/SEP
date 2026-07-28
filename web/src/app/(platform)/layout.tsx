import { AuthGate } from '@/components/auth-gate';
import { PlatformShell } from '@/components/shell/platform-shell';

/**
 * 平台运营端。全局 ADMIN 专用 —— 运营人员不属于任何企业，
 * 故只查全局角色，不要求企业归属。
 */
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate requireGlobalRole="ADMIN">
      <PlatformShell>{children}</PlatformShell>
    </AuthGate>
  );
}
