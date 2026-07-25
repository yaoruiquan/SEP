'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { Capability, DigitalEmployee } from '@/lib/types';

interface CapabilityListResponse {
  total: number;
  page: number;
  limit: number;
  items: Capability[];
}

// ─── Capability admin ───────────────────────────────────────────────────────

export function useAllCapabilities(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}&limit=50` : '?limit=50';
  return useQuery({
    queryKey: ['capabilities', { status: status ?? 'ALL' }],
    queryFn: () => api.get<CapabilityListResponse>(`/capabilities${qs}`),
  });
}

export function useApproveCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/capabilities/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['capabilities'] }),
  });
}

export function useRejectCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/capabilities/${id}/reject`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['capabilities'] }),
  });
}

export function useImportCozeBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { botId: string; name: string; description: string }) =>
      api.post<Capability>('/capabilities', {
        type: 'agent',
        name: data.name,
        description: data.description,
        industry: [],
        position: [],
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
        agentConfig: {
          platform: 'coze',
          botId: data.botId,
          // apiKey 留空,运行时回退到全局 COZE_PAT
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['capabilities'] }),
  });
}

// ─── Employee admin ──────────────────────────────────────────────────────────

type CreateEmployeeData = {
  name: string;
  description: string;
  industry: string;
  position: string;
  avatar?: string;
  systemPrompt: string;
  modelId?: string;
  maxSteps?: number;
  status?: string;
};

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateEmployeeData) =>
      api.post<DigitalEmployee>('/digital-employees', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.employees() }),
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateEmployeeData> }) =>
      api.patch<DigitalEmployee>(`/digital-employees/${id}`, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: qk.employees() });
      qc.invalidateQueries({ queryKey: qk.employee(id) });
    },
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/digital-employees/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.employees() }),
  });
}

export function useBindCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      capabilityId,
      order,
    }: {
      id: string;
      capabilityId: string;
      order?: number;
    }) => api.post(`/digital-employees/${id}/capabilities`, { capabilityId, order }),
    onSuccess: (_res, { id }) =>
      qc.invalidateQueries({ queryKey: qk.employee(id) }),
  });
}

export function useUnbindCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      capabilityId,
    }: {
      id: string;
      capabilityId: string;
    }) => api.delete(`/digital-employees/${id}/capabilities/${capabilityId}`),
    onSuccess: (_res, { id }) =>
      qc.invalidateQueries({ queryKey: qk.employee(id) }),
  });
}

// ─── System Settings ──────────────────────────────────────────────────────

export interface SettingView {
  key: string;
  label: string;
  secret: boolean;
  value?: string;
  configured: boolean;
}

export function useSettings() {
  return useQuery<SettingView[]>({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingView[]>('/settings'),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Record<string, string>) =>
      api.put<SettingView[]>('/settings', updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['models', 'available'] });
    },
  });
}
