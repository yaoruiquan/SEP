import { api } from '@/lib/api-client';

export interface EnterpriseListItem {
  id: string;
  name: string;
  description: string | null;
  logo: string | null;
  balance: number;
  memberCount: number;
  instanceCount: number;
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseListResponse {
  data: EnterpriseListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface EnterpriseDetail {
  id: string;
  name: string;
  description: string | null;
  logo: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    suspended?: boolean;
    suspendReason?: string;
    suspendedAt?: string;
    suspendedBy?: string;
    resumedAt?: string;
    resumedBy?: string;
  };
  members: Array<{
    id: string;
    role: string;
    user: {
      id: string;
      email: string;
      name: string | null;
      avatar: string | null;
      role: string;
    };
    department: {
      id: string;
      name: string;
    } | null;
  }>;
  instances: Array<{
    id: string;
    name: string;
    status: string;
    templateId: string;
    templateVersion: string;
    createdAt: string;
    template: {
      id: string;
      name: string;
      description: string;
    };
    department: {
      id: string;
      name: string;
    } | null;
  }>;
  computeAccount: {
    id: string;
    balance: number;
    transactions: Array<{
      id: string;
      type: string;
      amount: number;
      description: string | null;
      metadata: any;
      createdAt: string;
    }>;
  } | null;
  departments: Array<{
    id: string;
    name: string;
    parentId: string | null;
  }>;
}

export interface CreditAdjustmentRequest {
  amount: number;
  type: 'RECHARGE' | 'DEDUCT';
  note: string;
}

export interface CreditAdjustmentResponse {
  success: boolean;
  newBalance: number;
}

export interface SuspendEnterpriseRequest {
  reason: string;
}

export interface OperationResponse {
  success: boolean;
}

// Employee Management Types
export interface EmployeeListItem {
  id: string;
  name: string;
  description: string;
  industry: string;
  position: string;
  avatar: string | null;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
  version: string;
  annualPriceCNY: number | null;
  includedComputeCNY: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  bindings: Array<{
    capability: {
      id: string;
      name: string;
    };
  }>;
  _count: {
    bindings: number;
  };
}

export interface EmployeeListResponse {
  data: EmployeeListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface EmployeeDetail {
  id: string;
  name: string;
  description: string;
  industry: string;
  position: string;
  avatar: string | null;
  systemPrompt: string;
  modelId: string;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
  version: string;
  annualPriceCNY: number | null;
  includedComputeCNY: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  bindings: Array<{
    id: string;
    capability: {
      id: string;
      name: string;
      type: string;
      status: string;
    };
  }>;
  _count: {
    subscriptions: number;
    instances: number;
    sessions: number;
  };
}

export interface CreateEmployeeRequest {
  name: string;
  description?: string;
  industry?: string;
  position?: string;
  avatar?: string;
  systemPrompt?: string;
  modelId?: string;
  annualPriceCNY?: number;
  includedComputeCNY?: number;
}

export interface UpdateEmployeeRequest {
  name?: string;
  description?: string;
  industry?: string;
  position?: string;
  avatar?: string;
  systemPrompt?: string;
  modelId?: string;
  annualPriceCNY?: number;
  includedComputeCNY?: number;
}

export interface ComputeTransaction {
  id: string;
  type: 'RECHARGE' | 'CONSUME' | 'REFUND';
  amount: number;
  description: string | null;
  metadata: any;
  createdAt: string;
  sessionId: string | null;
  enterprise: {
    id: string;
    name: string;
  };
}

export interface ComputeTransactionsResponse {
  data: ComputeTransaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const adminApi = {
  /**
   * 获取企业列表
   */
  listEnterprises: (params?: {
    page?: number;
    pageSize?: number;
    keyword?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.keyword) searchParams.set('keyword', params.keyword);

    const query = searchParams.toString();
    return api.get<EnterpriseListResponse>(
      `/admin/enterprises${query ? `?${query}` : ''}`
    );
  },

  /**
   * 获取企业详情
   */
  getEnterpriseDetail: (id: string) => {
    return api.get<EnterpriseDetail>(`/admin/enterprises/${id}`);
  },

  /**
   * 充值或扣减算力
   */
  creditAdjustment: (id: string, data: CreditAdjustmentRequest) => {
    return api.post<CreditAdjustmentResponse>(
      `/admin/enterprises/${id}/credit`,
      data
    );
  },

  /**
   * 冻结企业
   */
  suspendEnterprise: (id: string, data: SuspendEnterpriseRequest) => {
    return api.post<OperationResponse>(
      `/admin/enterprises/${id}/suspend`,
      data
    );
  },

  /**
   * 解冻企业
   */
  resumeEnterprise: (id: string) => {
    return api.post<OperationResponse>(`/admin/enterprises/${id}/resume`);
  },

  /**
   * 获取平台级算力交易记录
   */
  getComputeTransactions: (params?: {
    type?: 'RECHARGE' | 'CONSUME' | 'REFUND';
    enterpriseId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set('type', params.type);
    if (params?.enterpriseId) searchParams.set('enterpriseId', params.enterpriseId);
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const query = searchParams.toString();
    return api.get<ComputeTransactionsResponse>(
      `/admin/compute/transactions${query ? `?${query}` : ''}`
    );
  },

  /**
   * 获取员工列表
   */
  listEmployees: (params?: {
    status?: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
    page?: number;
    pageSize?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

    const query = searchParams.toString();
    return api.get<EmployeeListResponse>(
      `/admin/employees${query ? `?${query}` : ''}`
    );
  },

  /**
   * 获取员工详情
   */
  getEmployeeDetail: (id: string) => {
    return api.get<EmployeeDetail>(`/admin/employees/${id}`);
  },

  /**
   * 创建员工
   */
  createEmployee: (data: CreateEmployeeRequest) => {
    return api.post<EmployeeDetail>('/admin/employees', data);
  },

  /**
   * 更新员工
   */
  updateEmployee: (id: string, data: UpdateEmployeeRequest) => {
    return api.put<EmployeeDetail>(`/admin/employees/${id}`, data);
  },

  /**
   * 发布员工
   */
  publishEmployee: (id: string) => {
    return api.post<EmployeeDetail>(`/admin/employees/${id}/publish`);
  },

  /**
   * 提交员工审核
   */
  submitEmployeeForReview: (id: string) => {
    return api.post<EmployeeDetail>(`/admin/employees/${id}/submit`);
  },

  /**
   * 下架员工
   */
  archiveEmployee: (id: string) => {
    return api.post<EmployeeDetail>(`/admin/employees/${id}/archive`);
  },

  /**
   * 删除员工
   */
  deleteEmployee: (id: string) => {
    return api.delete<OperationResponse>(`/admin/employees/${id}`);
  },

  /**
   * 审核通过员工
   */
  approveEmployee: (id: string, note?: string) => {
    return api.post<OperationResponse>(`/admin/employees/${id}/approve`, { note });
  },

  /**
   * 拒绝员工
   */
  rejectEmployee: (id: string, reason: string) => {
    return api.post<OperationResponse>(`/admin/employees/${id}/reject`, { reason });
  },

  /**
   * 获取员工绑定的能力
   */
  getEmployeeBindings: (employeeId: string) => {
    return api.get<EmployeeBindingItem[]>(`/admin/employees/${employeeId}/bindings`);
  },

  /**
   * 批量绑定能力
   */
  bindCapabilities: (employeeId: string, capabilityIds: string[]) => {
    return api.post<OperationResponse>(`/admin/employees/${employeeId}/bindings`, {
      capabilityIds,
    });
  },

  /**
   * 更新绑定配置
   */
  updateBinding: (
    bindingId: string,
    data: {
      priority?: number;
      enabled?: boolean;
      config?: any;
    }
  ) => {
    return api.patch<OperationResponse>(`/admin/bindings/${bindingId}`, data);
  },

  /**
   * 移除绑定
   */
  removeBinding: (bindingId: string) => {
    return api.delete<OperationResponse>(`/admin/bindings/${bindingId}`);
  },

  /**
   * 获取可用能力列表
   */
  getAvailableCapabilities: () => {
    return api.get<{ items: CapabilityItem[]; total: number; page: number; pageSize: number }>('/admin/capabilities');
  },

  /**
   * 创建能力
   */
  createCapability: (data: {
    name: string;
    description: string;
    type: string;
    industry: string[];
    position: string[];
    inputSchema: any;
    outputSchema: any;
    agentConfig?: {
      platform: string;
      region?: string;
      runtimeKind?: string;
      botId?: string;
      workflowId?: string;
      apiKey?: string;
    };
  }) => {
    return api.post<any>('/admin/capabilities', data);
  },

  /**
   * 创建 Coze 能力（API 接入模式：Bot ID / Workflow ID + PAT）
   */
  createCozeCapability: (data: {
    region: 'CN' | 'GLOBAL';
    runtimeKind: 'BOT_CHAT' | 'WORKFLOW';
    resourceId: string;
    apiKey?: string;
    name: string;
    description: string;
    industry: string[];
    position: string[];
  }) => {
    const payload = {
      type: 'AGENT',
      name: data.name,
      description: data.description,
      industry: data.industry,
      position: data.position,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      agentConfig: {
        platform: 'COZE',
        region: data.region,
        runtimeKind: data.runtimeKind,
        ...(data.runtimeKind === 'BOT_CHAT'
          ? { botId: data.resourceId }
          : { workflowId: data.resourceId }
        ),
        ...(data.apiKey && { apiKey: data.apiKey }),
      },
    };
    return api.post<any>('/admin/capabilities', payload);
  },

  /**
   * 创建 Coze 能力（URL 链接模式：仅存储 webUrl，前端跳转/嵌入）
   */
  createCozeUrlCapability: (data: {
    webUrl: string;
    name: string;
    description: string;
    industry: string[];
    position: string[];
  }) => {
    const payload = {
      type: 'AGENT',
      name: data.name,
      description: data.description,
      industry: data.industry,
      position: data.position,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      agentConfig: {
        platform: 'COZE',
        webUrl: data.webUrl,
      },
    };
    return api.post<any>('/admin/capabilities', payload);
  },

  /**
   * 提交能力审核
   */
  submitCapabilityForReview: (capabilityId: string) => {
    return api.post<OperationResponse>(`/admin/capabilities/${capabilityId}/submit`);
  },
};

// Binding related types
export interface EmployeeBindingItem {
  id: string;
  priority: number;
  enabled: boolean;
  config: any;
  capability: {
    id: string;
    name: string;
    description: string;
    type: string;
    status: string;
  };
}

export interface CapabilityItem {
  id: string;
  name: string;
  description: string;
  type: 'agent' | 'rpa' | 'skill' | 'ai-app';
  status: string;
}
