'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { AdoptEnterpriseVersionDtoSchema, ReviewSkillVersionDtoSchema } from '../../../../../../backend/src/shared/skill-version.dto';
import { monitorQuery, type MonitorDetail, type MonitorFilters, type MonitorRow } from './monitor';

export function useSkillMonitor(filters: MonitorFilters, page: number, limit: number) {
  return useQuery({
    queryKey: ['skill-versions', 'admin', 'monitor', filters, page, limit],
    queryFn: () => api.get<{ items: MonitorRow[]; total: number; page: number; limit: number }>(
      `/admin/skill-versions?${monitorQuery(filters, page, limit)}`,
    ),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
export function useMonitorDetail(id: string) {
  return useQuery({
    queryKey: ['skill-versions', 'preview', 'admin', id],
    queryFn: () => api.get<MonitorDetail>(`/admin/skill-versions/${encodeURIComponent(id)}`),
    enabled: Boolean(id), staleTime: 0, retry: false,
  });
}
export function useSelectSkillSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; changeSummary?: string; expectedUpdatedAt?: string }) =>
      api.post<MonitorDetail>(`/admin/skill-versions/${encodeURIComponent(id)}/adopt`, AdoptEnterpriseVersionDtoSchema.parse({ ...body, mode: 'DRAFT' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skill-versions'] }),
  });
}
export function useSubmitMonitorReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedUpdatedAt }: { id: string; expectedUpdatedAt: string }) =>
      api.post<MonitorDetail>(`/admin/skill-versions/${encodeURIComponent(id)}/submit-review`, { expectedUpdatedAt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skill-versions'] }),
  });
}
export function useMonitorReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; decision: 'APPROVE' | 'REJECT'; comment?: string; expectedUpdatedAt?: string }) =>
      api.post<MonitorDetail>(`/admin/skill-versions/${encodeURIComponent(id)}/review`, ReviewSkillVersionDtoSchema.parse(body)),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['skill-versions'] }),
        qc.invalidateQueries({ queryKey: ['capabilities'] }),
        qc.invalidateQueries({ queryKey: ['admin'] }),
      ]);
    },
  });
}
