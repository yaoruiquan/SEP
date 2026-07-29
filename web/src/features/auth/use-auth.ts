'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import {
  useAuthStore,
  defaultHomeFor,
  type AuthPayload,
} from '@/lib/auth-store';

/**
 * 只允许跳回**站内**路径，挡开放重定向。
 *
 * `?redirect=https://evil.com` 或 `//evil.com`（协议相对 URL，浏览器会
 * 当成跨站）若原样交给 router.replace，用户登录后就被带到站外，
 * 且是「刚输过密码」的时刻 —— 钓鱼的理想位置。
 * 故只接受以单个 `/` 开头的路径。
 */
function safeRedirect(target: string | null | undefined): string | null {
  if (!target) return null;
  if (!target.startsWith('/')) return null;
  if (target.startsWith('//')) return null;
  return target;
}

export function useLogin(redirectTo?: string | null) {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<AuthPayload>('/auth/login', body, { skipAuthRetry: true }),
    onSuccess: (data) => {
      setAuth(data);
      // 有合法的站内 redirect 就回原页面，否则按角色落地
      const target =
        safeRedirect(redirectTo) ?? defaultHomeFor(data.user, data.enterprise);
      router.replace(target);
    },
  });
}

/**
 * 注册即开公司：后端在一个事务里建 User + Enterprise + 首个
 * ENTERPRISE_ADMIN 成员 + 算力账户，故 enterpriseName 是必填。
 * 第二个人进企业只能由管理员在成员管理里添加，不走这个入口。
 */
export function useRegister() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: {
      email: string;
      password: string;
      enterpriseName: string;
      name?: string;
    }) => api.post<AuthPayload>('/auth/register', body, { skipAuthRetry: true }),
    onSuccess: (data) => {
      setAuth(data);
      router.replace(defaultHomeFor(data.user, data.enterprise));
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
      // 清除所有查询缓存，防止账号切换后上一个账号的数据泄漏 ——
      // 多租户下尤其重要：缓存里可能有另一家企业的部门/成员列表
      queryClient.clear();
      router.replace('/login');
    },
  });
}
