'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import {
  useAuthStore,
  defaultHomeFor,
  type AuthPayload,
} from '@/lib/auth-store';
import type { EnterpriseRole, InvitationPreview } from '@/lib/types';

/**
 * 只允许跳回**站内**路径，挡开放重定向。
 *
 * `?redirect=https://evil.com` 或 `//evil.com`（协议相对 URL，浏览器会
 * 当成跨站）若原样交给 router.replace，用户登录后就被带到站外，
 * 且是「刚输过密码」的时刻 —— 钓鱼的理想位置。
 * 故只接受以单个 `/` 开头的路径。
 */
export function safeRedirect(target: string | null | undefined): string | null {
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

/**
 * 校验邀请 token。公开接口 —— 被邀请人此刻通常还没有账号。
 *
 * `retry: false` 是必须的：无效 token 的 400 是**终态结论**，不是网络抖动。
 * 默认重试会让"链接失效"这句话延迟三次退避才出现，用户以为页面卡住。
 */
export function useVerifyInvitation(token: string | null) {
  return useQuery({
    queryKey: ['invitation-preview', token] as const,
    queryFn: () =>
      api.get<InvitationPreview>(
        `/auth/invitations/verify?token=${encodeURIComponent(token as string)}`,
      ),
    enabled: Boolean(token),
    retry: false,
    // 邀请状态在别处也可能变（管理员撤回、他人抢用），不缓存陈旧结论
    staleTime: 0,
  });
}

/**
 * 受邀注册：凭链接创建账号并直接加入企业，不建新公司。
 *
 * email 由邀请记录决定、不由用户填 —— 校验在后端（不匹配 401），
 * 前端把它设成只读只是省一次往返，不是安全边界。
 */
export function useRegisterByInvitation() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: {
      token: string;
      email: string;
      password: string;
      name?: string;
    }) =>
      api.post<AuthPayload>('/auth/register-by-invitation', body, {
        skipAuthRetry: true,
      }),
    onSuccess: (data) => {
      setAuth(data);
      router.replace(defaultHomeFor(data.user, data.enterprise));
    },
  });
}

/**
 * 已登录用户接受邀请。
 *
 * 响应只回 `{member, enterprise}` 而非完整 AuthPayload，所以不能直接
 * setAuth —— 得把 store 里的 enterprise/roleInEnterprise 补上，
 * 否则刚加入的人会被 AuthGate 判成仍然无归属，弹回 /no-enterprise。
 */
export function useAcceptInvitation() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.post<{
        member: { id: string; role: EnterpriseRole };
        enterprise: { id: string; name: string };
      }>('/auth/accept-invitation', { token }),
    onSuccess: (data) => {
      const { user, setAuth, token } = useAuthStore.getState();
      if (user && token) {
        setAuth({
          token,
          user,
          enterprise: data.enterprise,
          roleInEnterprise: data.member.role,
        });
      }
      // 上一个状态下缓存的都是"无企业"的空数据
      queryClient.clear();
      router.replace('/dashboard');
    },
  });
}

/**
 * 无归属账号开新公司。返回完整 AuthPayload，可直接 setAuth。
 */
export function useCreateEnterprise() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: { name: string }) =>
      api.post<AuthPayload>('/auth/create-enterprise', body),
    onSuccess: (data) => {
      setAuth(data);
      queryClient.clear();
      router.replace('/dashboard');
    },
  });
}

/**
 * 主动离职。成功后账号转为「无归属」，故必须清空 store 里的企业字段并
 * 送去 /no-enterprise —— 留在企业台会看到一堆 403。
 */
export function useLeaveEnterprise() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{
        removed: boolean;
        reclaimedGrants: number;
        canceledRequests: number;
        vacatedDepartments: { id: string; name: string }[];
        enterprise: { id: string; name: string };
      }>('/auth/leave-enterprise', {}),
    onSuccess: () => {
      const { user, token, setAuth } = useAuthStore.getState();
      if (user && token) {
        setAuth({ token, user, enterprise: null, roleInEnterprise: null });
      }
      queryClient.clear();
      router.replace('/no-enterprise');
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
