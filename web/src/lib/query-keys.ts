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
  instances: ['enterprise', 'instances'] as const,
  instanceGrants: (instanceId: string) => ['enterprise', 'grants', instanceId] as const,
  myEmployees: ['enterprise', 'my-employees'] as const,
};
