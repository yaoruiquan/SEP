/** Centralized TanStack Query keys — keep invalidation consistent. */
export const qk = {
  me: ['users', 'me'] as const,
  myStats: ['users', 'me', 'stats'] as const,
  employees: (params?: Record<string, unknown>) =>
    ['digital-employees', params ?? {}] as const,
  employee: (id: string) => ['digital-employees', id] as const,
  subscriptions: ['subscriptions'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  capabilities: (params?: Record<string, unknown>) =>
    ['capabilities', params ?? {}] as const,
  adminStats: ['admin', 'stats'] as const,
  adminUsers: ['admin', 'users'] as const,
};
