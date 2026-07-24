'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useAuthStore, type AuthUser } from '@/lib/auth-store';

interface AuthResponse {
  token: string;
  user: AuthUser;
}

export function useLogin() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<AuthResponse>('/auth/login', body, { skipAuthRetry: true }),
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      router.replace(data.user.role === 'ADMIN' ? '/admin' : '/dashboard');
    },
  });
}

export function useRegister() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: { email: string; password: string; name?: string }) =>
      api.post<AuthResponse>('/auth/register', body, { skipAuthRetry: true }),
    onSuccess: (data) => {
      setAuth(data.token, data.user);
      router.replace('/dashboard');
    },
  });
}

export function useLogout() {
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      clear();
      router.replace('/login');
    },
  });
}
