import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface EmployeeDetail {
  id: string;
  name: string;
  avatar: string | null;
  status: 'online' | 'offline' | 'busy';
  description: string | null;
  industry: string[];
  position: string[];
  createdAt: string;
  updatedAt: string;

  // 模板信息
  templateId: string | null;
  templateName: string | null;
  templateVersion: string | null;

  // 企业信息
  enterpriseId: string;
  enterpriseName?: string;

  // 部门信息
  departmentId: string | null;
  departmentName?: string | null;

  // 绑定的能力
  capabilities: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    order: number;
  }>;

  // 统计数据
  stats?: {
    totalTasks: number;
    successRate: number;
    avgResponseTime: number;
    monthCalls: number;
    monthSpend: number;
  };
}

/**
 * 获取员工详情
 */
export function useEmployeeDetail(employeeId: string) {
  return useQuery<EmployeeDetail>({
    queryKey: ['employees', employeeId],
    queryFn: async () => {
      const data = await api.get<any>(`/digital-employees/${employeeId}`);
      return normalizeEmployeeDetail(data);
    },
    enabled: !!employeeId,
    staleTime: 30_000, // 30s 缓存
  });
}

/**
 * 更新员工信息
 */
export function useUpdateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      id: string;
      name?: string;
      description?: string;
      departmentId?: string | null;
    }) => {
      const { id, ...data } = params;
      return await api.patch<any>(`/digital-employees/${id}`, data);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['employees', vars.id] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

/**
 * 删除员工
 */
export function useDeleteEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (employeeId: string) => {
      await api.delete(`/digital-employees/${employeeId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

/**
 * 数据格式化
 */
function normalizeEmployeeDetail(raw: any): EmployeeDetail {
  return {
    id: raw.id,
    name: raw.name,
    avatar: raw.avatar || null,
    status: raw.metadata?.status || 'offline',
    description: raw.description || null,
    industry: Array.isArray(raw.industry) ? raw.industry :
              typeof raw.industry === 'string' ? raw.industry.split(',').filter(Boolean) : [],
    position: Array.isArray(raw.position) ? raw.position :
              typeof raw.position === 'string' ? raw.position.split(',').filter(Boolean) : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,

    templateId: raw.templateId || null,
    templateName: raw.templateName || null,
    templateVersion: raw.templateVersion || null,

    enterpriseId: raw.enterpriseId,
    enterpriseName: raw.enterprise?.name,

    departmentId: raw.departmentId || null,
    departmentName: raw.department?.name || null,

    capabilities: (raw.bindings || []).map((b: any) => ({
      id: b.capability.id,
      name: b.capability.name,
      type: b.capability.type,
      status: b.capability.status,
      order: b.order,
    })),

    // 统计数据（TODO: 后端补充）
    stats: {
      totalTasks: 0,
      successRate: 0,
      avgResponseTime: 0,
      monthCalls: 0,
      monthSpend: 0,
    },
  };
}
