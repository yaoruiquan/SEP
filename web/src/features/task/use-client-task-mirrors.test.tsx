import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { normalizeClientTaskMirrorPage, useClientTaskMirror, useClientTaskMirrors, useClientTaskMirrorFilterOptions, type ClientTaskMirror } from './use-client-task-mirrors';

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
  it('sends every list filter to the server and refetches when filters change', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 0 });
    const { result, rerender } = renderHook(({ q }) => useClientTaskMirrors(true, {
      scope: 'enterprise', subscriptionId: 'sub-1', userId: 'u-1', statuses: 'PAUSED,FAILED', view: 'attention',
      taskType: 'conversation', from: '2026-10-08T16:00:00Z', to: '2026-10-09T16:00:00Z', q, sort: 'startedAt_asc',
    }), { initialProps: { q: 'a b' }, wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = new URL(vi.mocked(api.get).mock.calls[0][0], 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '1', limit: '50', scope: 'enterprise', subscriptionId: 'sub-1',
      userId: 'u-1', statuses: 'PAUSED,FAILED', view: 'attention', taskType: 'conversation', from: '2026-10-08T16:00:00Z', to: '2026-10-09T16:00:00Z', q: 'a b', sort: 'startedAt_asc' });
    rerender({ q: 'new' });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.get).mock.calls[1][0]).toContain('q=new');
  });
  it('fetches authorized options without view/statuses/paging/sort and keeps their own cache', async () => {
    const data = { users: [], subscriptions: [], taskTypes: [], counts: { active: 0, attention: 0, history: 0 } };
    vi.mocked(api.get).mockResolvedValue(data);
    const { result, rerender } = renderHook(({ view, userId }: { view: 'active' | 'history'; userId: string }) => useClientTaskMirrorFilterOptions({
      view, userId, page: 2, limit: 50, sort: 'queuedAt_desc', statuses: 'FAILED', subscriptionId: 's-1',
    }), { initialProps: { view: 'active', userId: 'u-1' }, wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(data));
    expect(api.get).toHaveBeenCalledWith('/client/tasks/filter-options?userId=u-1&subscriptionId=s-1');
    rerender({ view: 'history', userId: 'u-1' });
    expect(api.get).toHaveBeenCalledTimes(1);
    rerender({ view: 'history', userId: 'u-2' });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
  it('encodes authorized detail IDs independently of list filters', async () => {
    vi.mocked(api.get).mockResolvedValue({ events: [] });
    const { result } = renderHook(() => useClientTaskMirror('mirror/a?b'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/client/tasks/mirror%2Fa%3Fb');
  });
});
