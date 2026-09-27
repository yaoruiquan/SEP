'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export type AdminAuthUser = {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: string;
  status: 'ACTIVE' | 'DISABLED';
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  identityCount: number;
  sessionCount: number;
  eventCount: number;
};

export type AdminAuthUserDetail = Omit<AdminAuthUser, 'identityCount' | 'sessionCount' | 'eventCount'> & {
  authCredentials: Array<{ type: string; failedCount: number; lockedUntil: string | null; lastUsedAt: string | null }>;
  authIdentities: Array<{ id: string; provider: string; providerAccountId: string; providerEmail: string | null; emailVerified: boolean | null; lastUsedAt: string | null; createdAt: string }>;
  authSessions: Array<{ id: string; type: string; deviceId: string | null; familyId: string; createdAt: string; lastUsedAt: string | null; expiresAt: string }>;
};

export type AdminAuthEvent = {
  id: string;
  action: string;
  success: boolean;
  provider: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
};

export function useAdminAuthUsers(params: { keyword?: string; status?: string; page?: number; pageSize?: number }) {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set('keyword', params.keyword);
  if (params.status) qs.set('status', params.status);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  return useQuery({
    queryKey: ['admin', 'auth-users', params],
    queryFn: () => api.get<{ items: AdminAuthUser[]; total: number; page: number; pageSize: number; totalPages: number }>(`/admin/auth/users?${qs}`),
  });
}

export function useAdminAuthUser(userId: string) {
  return useQuery({
    queryKey: ['admin', 'auth-user', userId],
    queryFn: () => api.get<AdminAuthUserDetail>(`/admin/auth/users/${userId}`),
    enabled: Boolean(userId),
  });
}

export function useAdminAuthUserEvents(userId: string) {
  return useQuery({
    queryKey: ['admin', 'auth-user-events', userId],
    queryFn: () => api.get<AdminAuthEvent[]>(`/admin/auth/users/${userId}/events?limit=100`),
    enabled: Boolean(userId),
  });
}

function useAdminAuthAction(userId: string, action: string) {
  const qc = useQueryClient();
  const isPatch = action === 'disable' || action === 'enable';
  return useMutation({
    mutationFn: (body: unknown = undefined) => isPatch
      ? api.patch(`/admin/auth/users/${userId}/${action}`, body)
      : api.post(`/admin/auth/users/${userId}/${action}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'auth-user', userId] });
      qc.invalidateQueries({ queryKey: ['admin', 'auth-user-events', userId] });
      qc.invalidateQueries({ queryKey: ['admin', 'auth-users'] });
    },
  });
}

export function useDisableAdminAuthUser(userId: string) { return useAdminAuthAction(userId, 'disable'); }
export function useEnableAdminAuthUser(userId: string) { return useAdminAuthAction(userId, 'enable'); }
export function useForceLogoutAdminAuthUser(userId: string) { return useAdminAuthAction(userId, 'logout-all'); }
export function useForceEmailVerification(userId: string) { return useAdminAuthAction(userId, 'require-email-verification'); }
export function useForcePasswordReset(userId: string) { return useAdminAuthAction(userId, 'force-password-reset'); }
