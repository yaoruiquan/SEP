'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      clear();
      // 🔴 修复 P1-1: 清除所有查询缓存,防止账号切换后数据泄漏
      queryClient.clear();
      router.replace('/login');
    },
  });
}
