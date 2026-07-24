import { AuthGate } from '@/components/auth-gate';
import { UserShell } from '@/components/shell/user-shell';

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <UserShell>{children}</UserShell>
    </AuthGate>
  );
}
