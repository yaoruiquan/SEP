/** Centralized TanStack Query keys — keep invalidation consistent. */
export const qk = {
  me: ['users', 'me'] as const,
  myStats: ['users', 'me', 'stats'] as const,
  employees: (params?: Record<string, unknown>) =>
    ['digital-employees', params ?? {}] as const,
  employee: (id: string) => ['digital-employees', id] as const,
  employeePackages: (id: string) =>
    ['digital-employees', id, 'packages'] as const,
  subscriptions: ['subscriptions'] as const,
  // 拍平成员工形状的订阅列表（聊天页的员工选择器用）。必须与 subscriptions
  // 分开缓存 —— 同 key 不同形状会互相覆盖：谁先加载谁赢，另一方读到的
  // 对象缺字段（头像变 ?、id 变订阅 id 导致去重失效和路由到错员工）。
  subscribedEmployees: ['subscriptions', 'as-employees'] as const,
  // 人才市场（公开接口，与管理端 employees 分开缓存 —— 字段不同）
  marketEmployees: (search: string) => ['market', 'employees', search] as const,
  marketEmployee: (id: string) => ['market', 'employees', id] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  capabilities: (params?: Record<string, unknown>) =>
    ['capabilities', params ?? {}] as const,
  adminStats: ['admin', 'stats'] as const,
  adminUsers: ['admin', 'users'] as const,
  // 企业组织
  departments: ['enterprise', 'departments'] as const,
  members: (deptId?: string) =>
    deptId ? ['enterprise', 'members', deptId] : (['enterprise', 'members'] as const),
  invitations: (status?: string) =>
    status
      ? (['enterprise', 'invitations', status] as const)
      : (['enterprise', 'invitations'] as const),
  deptMembers: (deptId: string, params?: Record<string, unknown>) =>
    ['enterprise', 'departments', deptId, 'members', params ?? {}] as const,
  subscriptionGrants: (subscriptionId: string) =>
    ['enterprise', 'grants', subscriptionId] as const,
  myEmployees: ['enterprise', 'my-employees'] as const,
  // Phase 1: 模型配置中心
  modelConfig: (enterpriseId: string) =>
    ['enterprise', enterpriseId, 'model-config'] as const,
  availableModels: (enterpriseId: string) =>
    ['enterprise', enterpriseId, 'available-models'] as const,
  effectiveModelConfig: (enterpriseId?: string, opts?: Record<string, unknown>) =>
    ['enterprise', enterpriseId ?? 'unknown', 'effective-model-config', opts ?? {}] as const,
};
