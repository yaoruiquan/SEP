import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/auth-store';

type Identity = Pick<ReturnType<typeof useAuthStore.getState>, 'user' | 'enterprise' | 'roleInEnterprise'>;
const prefixes = new Set(['knowledge-bases', 'knowledge-base', 'documents', 'knowledge-preview', 'knowledge-document-versions',
  'knowledge-document-status', 'knowledge-grants', 'knowledge-grant-candidates', 'knowledge-analytics', 'text-chunks']);

function scope(state: Identity) {
  return JSON.stringify([state.user?.id ?? null, state.enterprise?.id ?? null, state.roleInEnterprise]);
}

export function useKnowledgeCacheScope() {
  return useAuthStore(scope);
}

/** A new account, enterprise or role must not inherit cached enterprise documents. */
export function watchKnowledgeIdentity(client: QueryClient) {
  return useAuthStore.subscribe((next, previous) => {
    if (scope(next) === scope(previous)) return;
    const filters = { predicate: (query: { queryKey: readonly unknown[] }) => prefixes.has(String(query.queryKey[0])) };
    void client.cancelQueries(filters);
    client.removeQueries(filters);
  });
}

export const knowledgeQueryOptions = {
  staleTime: 0,
  refetchOnMount: 'always' as const,
  refetchOnWindowFocus: true,
  retry: false as const,
};
