'use client';

import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { api } from '@/lib/api-client';
import type { EmployeeAvatarAsset } from '@/lib/types';

interface SubscribedEmployee {
  id: string;
  name: string;
  avatar: string | null;
  avatarAsset?: EmployeeAvatarAsset | null;
  industry: string;
  position: string;
}

/**
 * 获取当前用户订阅的所有员工（用于多员工协作选择器）
 */
export function useSubscribedEmployees() {
  return useQuery({
    queryKey: qk.subscribedEmployees,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    queryFn: async (): Promise<SubscribedEmployee[]> => {
      const response = await api.get<any[]>('/subscriptions');

      if (!Array.isArray(response)) return [];

      return response
        .filter((sub: any) => sub?.employee?.id)
        .map((sub: any) => ({
          id: sub.employee.id,
          name: sub.employee.name,
          avatar: sub.employee.avatar ?? null,
          avatarAsset: sub.employee.avatarAsset,
          industry: sub.employee.industry,
          position: sub.employee.position,
        }));
    },
  });
}
