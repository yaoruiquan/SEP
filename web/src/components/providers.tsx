'use client';

import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tryRefresh } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { ThemeProvider } from '@/lib/theme-provider';
import { Toaster } from '@/components/ui/toast';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60_000, // 5分钟缓存，减少不必要的重新请求
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnMount: false, // 避免每次组件挂载都重新请求
          },
        },
      }),
  );

  const setHydrated = useAuthStore((s) => s.setHydrated);
  const booted = useRef(false);

  // On first mount, try to rehydrate the in-memory access token from the
  // refresh cookie. Mark hydrated regardless so AuthGate can decide.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    tryRefresh().finally(() => setHydrated());
  }, [setHydrated]);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
