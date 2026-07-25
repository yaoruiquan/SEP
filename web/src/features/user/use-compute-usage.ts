import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface ComputeUsageResponse {
  balance: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    description: string | null;
    metadata: any;
    createdAt: string;
  }>;
}

export function useComputeUsage() {
  return useQuery<ComputeUsageResponse>({
    queryKey: ['compute-usage'],
    queryFn: async () => {
      const res = await api.get<ComputeUsageResponse>('/users/me/compute-usage');
      return res;
    },
  });
}
