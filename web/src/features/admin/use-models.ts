import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface ModelItem {
  id: string;
  label: string;
  vendor?: string;
  category?: string;
  description?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  pricingInputPer1M?: number | null;
  pricingOutputPer1M?: number | null;
  supportedFeatures?: string[];
}

/**
 * 获取平台已启用的模型列表
 */
export function useEnabledModels() {
  return useQuery({
    queryKey: ['models', 'enabled'],
    queryFn: async () => {
      const response = await api.get<ModelItem[]>('/models/enabled');
      return response;
    },
    staleTime: 5 * 60 * 1000, // 5分钟缓存
  });
}
