'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { Capability, CapabilityType } from '@/lib/types';

interface CapabilityListParams {
  type?: CapabilityType;
  industry?: string;
  position?: string;
  page?: number;
  limit?: number;
}

interface CapabilityListResponse {
  total: number;
  page: number;
  limit: number;
  items: Capability[];
}

export function useCapabilities(params?: CapabilityListParams) {
  const query = new URLSearchParams();
  if (params?.type) query.set('type', params.type.toLowerCase());
  if (params?.industry) query.set('industry', params.industry);
  if (params?.position) query.set('position', params.position);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();

  return useQuery({
    queryKey: qk.capabilities(params as Record<string, unknown> | undefined),
    queryFn: () => api.get<CapabilityListResponse>(`/capabilities${qs ? `?${qs}` : ''}`),
  });
}

export function useCapability(id: string | null) {
  return useQuery({
    queryKey: ['capabilities', id ?? ''],
    queryFn: () => api.get<Capability>(`/capabilities/${id}`),
    enabled: !!id,
  });
}
