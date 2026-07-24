'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/lib/auth-store';
import type { UserProfile } from '@/lib/types';

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<UserProfile>('/users/me'),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; avatar?: string }) =>
      api.patch<UserProfile>('/users/me', body),
    onSuccess: (user) => {
      qc.setQueryData(qk.me, user);
      // keep the in-memory auth user's display name in sync
      const store = useAuthStore.getState();
      if (store.token) {
        store.setAuth(store.token, {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        });
      }
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.patch<void>('/users/me/password', body),
  });
}
