'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { CenteredSpinner } from '@/components/ui/feedback';

/**
 * Wraps protected route groups. Waits for the boot refresh to resolve, then
 * redirects unauthenticated users to /login. When `requireRole` is set,
 * users without that role are bounced to their default home.
 */
export function AuthGate({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  requireRole?: 'ADMIN';
}) {
  const router = useRouter();
  const { token, user, hydrated } = useAuthStore();

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    if (requireRole && user?.role !== requireRole) {
      router.replace('/dashboard');
    }
  }, [hydrated, token, user, requireRole, router]);

  if (!hydrated || !token) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <CenteredSpinner label="加载中…" />
      </div>
    );
  }
  if (requireRole && user?.role !== requireRole) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <CenteredSpinner label="正在跳转…" />
      </div>
    );
  }
  return <>{children}</>;
}
