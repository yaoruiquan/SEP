import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { normalizeClientTaskMirrorPage, useClientTaskMirror, useClientTaskMirrors, type ClientTaskMirror } from './use-client-task-mirrors';

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn() } }));
const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe('client task queries', () => {
  it('requests paged data with scope and changes cache keys between pages', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 100, page: 1, limit: 50, hasNextPage: true });
    const { result, rerender } = renderHook(({ page }) => useClientTaskMirrors(true, { page, scope: 'mine' }), { initialProps: { page: 1 }, wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/client/tasks?page=1&limit=50&scope=mine');
    rerender({ page: 2 });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/client/tasks?page=2&limit=50&scope=mine'));
  });
  it('does not force enterprise scope on the default query', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    const { result } = renderHook(() => useClientTaskMirrors(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/client/tasks?page=1&limit=50');
  });
  it('normalizes old arrays with local paging and a legacy flag without dropping records', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }) as ClientTaskMirror);
    const normalized = normalizeClientTaskMirrorPage(items, 2, 50);
    expect(normalized.items).toEqual(items.slice(50));
    expect(normalized.total).toBe(100);
    expect(normalized.legacy).toBe(true);
    expect(normalized.hasNextPage).toBe(false);
  });
  it('does not fetch disabled list/detail', () => {
    renderHook(() => { useClientTaskMirrors(false); useClientTaskMirror('mirror', false); }, { wrapper: wrapper() });
    expect(api.get).not.toHaveBeenCalled();
  });
  it('keeps detail API contract unchanged', async () => {
    vi.mocked(api.get).mockResolvedValue({ events: [] });
    const { result } = renderHook(() => useClientTaskMirror('mirror'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/client/tasks/mirror');
  });
});
