import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api-client';
import { useDocuments } from './use-documents';
import { watchKnowledgeIdentity } from './knowledge-cache';
import { useKnowledgeBases } from './use-knowledge-bases';

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }));
afterEach(() => { cleanup(); useAuthStore.getState().clear(); vi.resetAllMocks(); });

it('clears only knowledge caches on identity/role change, not an ordinary token refresh', () => {
  const client = new QueryClient();
  useAuthStore.setState({ user: { id: 'user-a', name: null, email: 'a@example.com', avatar: null, role: 'USER' }, enterprise: { id: 'enterprise-a', name: '企业A' }, roleInEnterprise: 'ENTERPRISE_ADMIN' });
  client.setQueryData(['knowledge-preview', 'kb', 'doc'], { text: '企业机密' });
  client.setQueryData(['subscriptions'], ['employee']);
  const unsubscribe = watchKnowledgeIdentity(client);
  useAuthStore.setState({ token: 'refreshed' });
  expect(client.getQueryData(['knowledge-preview', 'kb', 'doc'])).toBeDefined();
  useAuthStore.setState({ roleInEnterprise: 'MEMBER' });
  expect(client.getQueryData(['knowledge-preview', 'kb', 'doc'])).toBeUndefined();
  expect(client.getQueryData(['subscriptions'])).toEqual(['employee']);
  unsubscribe(); client.clear();
});

it('never displays the previous enterprise documents while the next scope is loading', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ enterprise: { id: 'enterprise-a', name: '企业A' } });
  vi.mocked(api.get).mockResolvedValueOnce([{ id: 'doc-a', status: 'READY' }]).mockImplementationOnce(() => new Promise(() => {}));
  const { result } = renderHook(() => useDocuments('kb'), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.[0].id).toBe('doc-a');
  act(() => { useAuthStore.setState({ enterprise: { id: 'enterprise-b', name: '企业B' } }); });
  expect(result.current.data).toBeUndefined();
  client.clear();
});

it('keeps list placeholders only for pagination within the same identity', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ enterprise: { id: 'enterprise-a', name: '企业A' } });
  const list = { items: [{ id: 'kb-a', name: '企业A内部资料' }], page: 1, pageSize: 20, total: 21 };
  vi.mocked(api.get).mockResolvedValueOnce(list).mockImplementation(() => new Promise(() => {}));
  const { result, rerender } = renderHook(({ page }) => useKnowledgeBases({ page }), {
    initialProps: { page: 1 },
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  rerender({ page: 2 });
  expect(result.current.data?.items[0].name).toBe('企业A内部资料');
  expect(result.current.isPlaceholderData).toBe(true);
  act(() => { useAuthStore.setState({ enterprise: { id: 'enterprise-b', name: '企业B' } }); });
  expect(result.current.data).toBeUndefined();
  expect(result.current.isPlaceholderData).toBe(false);
  client.clear();
});
