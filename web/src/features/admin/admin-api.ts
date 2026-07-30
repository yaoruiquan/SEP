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
};
