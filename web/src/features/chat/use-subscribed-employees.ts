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
    queryKey: qk.subscriptions,
    queryFn: async (): Promise<SubscribedEmployee[]> => {
      try {
        const response = await api.get<any[]>('/subscriptions');
        console.log('[useSubscribedEmployees] Raw response:', response);

        if (!Array.isArray(response)) {
          console.warn('[useSubscribedEmployees] Response is not an array:', response);
          return [];
        }

        const employees = response.map((sub: any) => ({
          id: sub.employee.id,
          name: sub.employee.name,
          avatar: sub.employee.avatar,
          industry: sub.employee.industry,
          position: sub.employee.position,
        }));

        console.log('[useSubscribedEmployees] Parsed employees:', employees);
        return employees;
      } catch (error) {
        console.error('[useSubscribedEmployees] Error fetching subscriptions:', error);
        return [];
      }
    },
  });
}
