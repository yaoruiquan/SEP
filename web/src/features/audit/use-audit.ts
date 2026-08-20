import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';

interface ApproveCapabilityParams {
  id: string;
  comment?: string;
}

interface RejectCapabilityParams {
  id: string;
  reason: string;
}

// 获取待审核能力列表
// 注意：管理端必须走受 ADMIN 守卫保护的接口，公开 /capabilities 只返回已审核数据。
// 页面按 { data } 读取，这里统一成 data，避免列表恒为空。
export function usePendingCapabilities() {
  return useQuery({
    queryKey: ['capabilities', 'pending'],
    queryFn: async () => {
      const response = await api.get<any>('/admin/capabilities?status=PENDING&pageSize=100');
      const rows = response?.items ?? response?.data ?? [];
      return {
        data: rows.map((c: any) => ({
          ...c,
          industry: toTagArray(c.industry),
          position: toTagArray(c.position),
          submittedAt: c.createdAt,
        })),
        total: response?.total ?? rows.length,
      };
    },
  });
}

// 批准能力
export function useApproveCapability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: ApproveCapabilityParams) => {
      return api.post(`/capabilities/${id}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capabilities', 'pending'] });
      queryClient.invalidateQueries({ queryKey: qk.capabilities() });
    },
  });
}

// 拒绝能力
export function useRejectCapability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: RejectCapabilityParams) => {
      return api.post(`/capabilities/${id}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capabilities', 'pending'] });
      queryClient.invalidateQueries({ queryKey: qk.capabilities() });
    },
  });
}

/** 审核页使用的员工条目形状（industry/position 统一为数组） */
export interface PendingEmployeeItem {
  id: string;
  name: string;
  avatar: string | null;
  industry: string[];
  position: string[];
  description: string;
  capabilityCount: number;
  submittedAt: string;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
  capabilities: Array<{
    id: string;
    name: string;
    type: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  }>;
}

/**
 * DigitalEmployee.industry / position 在库里是单个 String，
 * 审核页按数组渲染（`.map()`），这里统一整形，空值转成空数组。
 */
function toTagArray(value?: string | string[] | null): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value
    .split(/[,，/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizePendingEmployee(raw: any): PendingEmployeeItem {
  return {
    id: raw.id,
    name: raw.name,
    avatar: raw.avatar ?? null,
    industry: toTagArray(raw.industry),
    position: toTagArray(raw.position),
    description: raw.description ?? '',
    capabilityCount: raw._count?.bindings ?? raw.bindings?.length ?? 0,
    // 提交审核时会更新 updatedAt，用它当"提交时间"
    submittedAt: raw.updatedAt ?? raw.createdAt,
    status: raw.status,
    capabilities: (raw.bindings ?? [])
      .map((b: any) => b.capability)
      .filter(Boolean)
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        status: c.status,
      })),
  };
}

// 获取待审核员工列表
export function usePendingEmployees() {
  return useQuery({
    queryKey: ['employees', 'pending'],
    queryFn: async () => {
      const response = await api.get<any>('/admin/employees?status=PENDING&pageSize=100');
      const rows = response?.data ?? [];
      return rows.map(normalizePendingEmployee);
    },
  });
}

// 批准员工
export function useApproveEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    // 后端字段是 note，页面传的是 comment，这里做映射
    mutationFn: async ({ id, comment }: { id: string; comment?: string }) => {
      return api.post(`/admin/employees/${id}/approve`, { note: comment || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', 'pending'] });
      queryClient.invalidateQueries({ queryKey: qk.employees() });
    },
  });
}

// 拒绝员工
export function useRejectEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return api.post(`/admin/employees/${id}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', 'pending'] });
      queryClient.invalidateQueries({ queryKey: qk.employees() });
    },
  });
}
