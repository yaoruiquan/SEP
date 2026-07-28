'use client';

import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { useAuthStore, defaultHomeFor } from '@/lib/auth-store';

/**
 * 人才市场顶栏。市场是**公开**的（未登录可浏览），
 * 未登录时显示登录/注册入口，已登录时显示回控制台的入口。
 */
export function MarketHeader() {
  const { token, user, enterprise, hydrated } = useAuthStore();
  const loggedIn = hydrated && Boolean(token);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/marketplace" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="硅基人才平台"
            width={28}
            height={28}
            className="rounded"
            priority
          />
          <span className="text-sm font-semibold">硅基人才市场</span>
        </Link>

        <nav className="flex items-center gap-2">
          {loggedIn ? (
            <Link
              href={defaultHomeFor(user, enterprise)}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              {enterprise ? enterprise.name : '控制台'}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
              >
                登录
              </Link>
              <Link
                href="/register"
                className={cn(buttonVariants({ size: 'sm' }))}
              >
                免费注册
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
