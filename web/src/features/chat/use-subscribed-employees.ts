'use client';

import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/query-keys';
import { api } from '@/lib/api-client';

interface SubscribedEmployee {
  id: string;
  name: string;
  avatar: string | null;
  industry: string;
  position: string;
}

/**
 * 获取当前用户订阅的所有员工（用于多员工协作选择器）
 */
export function useSubscribedEmployees() {
  return useQuery({
    queryKey: qk.subscribedEmployees,
    queryFn: async (): Promise<SubscribedEmployee[]> => {
      const response = await api.get<any[]>('/subscriptions');

      if (!Array.isArray(response)) return [];

      return response
        .filter((sub: any) => sub?.employee?.id)
        .map((sub: any) => ({
          id: sub.employee.id,
          name: sub.employee.name,
          avatar: sub.employee.avatar ?? null,
          industry: sub.employee.industry,
          position: sub.employee.position,
        }));
    },
  });
}
