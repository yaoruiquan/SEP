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
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
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
