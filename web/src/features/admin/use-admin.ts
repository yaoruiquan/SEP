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
  const qs = status ? `?status=${encodeURIComponent(status)}&pageSize=50` : '?pageSize=50';
  return useQuery({
    queryKey: ['capabilities', { status: status ?? 'ALL' }],
    queryFn: async () => {
      const response = await api.get<{
        items: Capability[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/admin/capabilities${qs}`);
      return { ...response, limit: response.pageSize } satisfies CapabilityListResponse;
    },
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

export function useCreateCozeCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      region: 'CN' | 'GLOBAL';
      runtimeKind: 'BOT_CHAT' | 'WORKFLOW';
      resourceId: string;
      apiKey?: string;
      name: string;
      description: string;
      industry: string[];
      position: string[];
    }) => adminApi.createCozeCapability(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['capabilities'] }),
  });
}

export function useCreateCozeUrlCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      webUrl: string;
      name: string;
      description: string;
      industry: string[];
      position: string[];
    }) => adminApi.createCozeUrlCapability(data),
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

// ─── Enterprise admin ─────────────────────────────────────────────────────────

/**
 * 全部企业。走 `/admin/enterprises`（钱包口径），而不是
 * `/enterprise/admin/all-enterprises`（返回的是废弃的 ComputeAccount.balance）。
 *
 * ⚠️ 列表项里的 `balance` 是**钱包余额**（EnterpriseWallet.balance）。
 * ComputeAccount.balance 在 schema 里已标注废弃、只有 gateway 链路还在写，
 * 运营端读它会看到一个永远不变的假余额 —— 演示租户钱包里有 ¥49,568，那个字段是 ¥0。
 *
 * pageSize 给足：这个列表同时喂「企业管理」表格和「账户管理」的充值企业选择器，
 * 分页截断会让选择器里搜不到企业。
 */
export function useAllEnterprises() {
  return useQuery({
    queryKey: ['admin', 'enterprises'],
    queryFn: async () => {
      const response = await adminApi.listEnterprises({ pageSize: 200 });
      return response.data;
    },
  });
}

// Import admin API types
import type {
  EnterpriseListResponse,
  EnterpriseDetail,
  CreditAdjustmentRequest,
  SuspendEnterpriseRequest,
} from './admin-api';
import { adminApi } from './admin-api';

export function useEnterprisesList(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}) {
  return useQuery({
    queryKey: ['admin', 'enterprises', 'list', params],
    queryFn: () => adminApi.listEnterprises(params),
  });
}

export function useEnterpriseDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'enterprises', id],
    queryFn: () => adminApi.getEnterpriseDetail(id),
    enabled: !!id,
  });
}

export function useCreditAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreditAdjustmentRequest }) =>
      adminApi.creditAdjustment(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises', 'list'] });
    },
  });
}

export function useSuspendEnterprise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: SuspendEnterpriseRequest }) =>
      adminApi.suspendEnterprise(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises', 'list'] });
    },
  });
}

export function useResumeEnterprise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.resumeEnterprise(id),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'enterprises', 'list'] });
    },
  });
}

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

/**
 * 系统默认「订阅赠送算力（元）」。
 *
 * 员工表单用它做占位提示：运营留空赠送金额时，实际生效的就是这个值。
 * 不展示的话运营无从判断「留空」意味着赠送多少钱。
 */
export function useDefaultEmployeeGiftCNY() {
  const { data: settings, ...rest } = useSettings();
  const raw = settings?.find((s) => s.key === 'DEFAULT_EMPLOYEE_GIFT_CNY')?.value;
  const parsed = Number(raw);
  return {
    ...rest,
    data: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
  };
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

// ─── Compute Transactions ─────────────────────────────────────────────────────

import type { ComputeTransactionsResponse } from './admin-api';

export function useComputeTransactions(params?: {
  type?: 'RECHARGE' | 'CONSUME' | 'REFUND';
  enterpriseId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'compute', 'transactions', params],
    queryFn: () => adminApi.getComputeTransactions(params),
  });
}

// ─── Employee Capability Bindings ─────────────────────────────────────────────

export function useAvailableCapabilities() {
  return useQuery({
    queryKey: ['available-capabilities'],
    queryFn: async () => {
      const response = await adminApi.getAvailableCapabilities();
      // 后端返回 { items, total, page, pageSize }，提取 items 数组
      return response.items;
    },
  });
}

export function useEmployeeBindings(employeeId: string) {
  return useQuery({
    queryKey: ['employee-bindings', employeeId],
    queryFn: () => adminApi.getEmployeeBindings(employeeId),
    enabled: !!employeeId,
  });
}

export function useBindCapabilities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      employeeId,
      capabilityIds,
    }: {
      employeeId: string;
      capabilityIds: string[];
    }) => adminApi.bindCapabilities(employeeId, capabilityIds),
    onSuccess: (_res, { employeeId }) => {
      qc.invalidateQueries({ queryKey: ['employee-bindings', employeeId] });
      qc.invalidateQueries({ queryKey: ['admin-employee', employeeId] });
    },
  });
}

export function useUpdateBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bindingId,
      data,
    }: {
      bindingId: string;
      data: { priority?: number; enabled?: boolean; config?: any };
    }) => adminApi.updateBinding(bindingId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-bindings'] });
    },
  });
}

export function useRemoveBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bindingId: string) => adminApi.removeBinding(bindingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-bindings'] });
      qc.invalidateQueries({ queryKey: ['admin-employee'] });
    },
  });
}
