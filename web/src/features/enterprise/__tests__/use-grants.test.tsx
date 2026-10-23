import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCreateGrants } from '../use-enterprise';
import { qk } from '@/lib/query-keys';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: { post: mocks.post } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('batch grant mutation', () => {
  it.each(['member', 'department'] as const)('sends one %s batch and refreshes authorization and usage caches', async (target) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const keys = [qk.subscriptionGrants('sub-1'), qk.myEmployees, qk.subscriptions, qk.subscribedEmployees];
    keys.forEach((key) => client.setQueryData(key, []));
    client.setQueryData(qk.subscriptionGrants('sub-2'), []);
    const body = { ...(target === 'member' ? { memberIds: ['a', 'b'] } : { departmentIds: ['a', 'b'] }), renewExpired: true };
    const response = { target, createdIds: ['a'], renewedIds: ['b'], skippedIds: [] };
    mocks.post.mockResolvedValue(response);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useCreateGrants(), { wrapper });

    await act(async () => {
      expect(await result.current.mutateAsync({ subscriptionId: 'sub-1', ...body })).toEqual(response);
    });

    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/enterprise/subscriptions/sub-1/grants/batch', body);
    keys.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(client.getQueryState(qk.subscriptionGrants('sub-2'))?.isInvalidated).toBe(false);
    client.clear();
  });

  it('preserves caches when the entire batch is rejected', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(qk.subscriptionGrants('sub-1'), [{ id: 'existing' }]);
    mocks.post.mockRejectedValue(new Error('invalid target'));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useCreateGrants(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ subscriptionId: 'sub-1', memberIds: ['invalid'], renewExpired: false })).rejects.toThrow('invalid target');
    });
    expect(client.getQueryState(qk.subscriptionGrants('sub-1'))?.isInvalidated).toBe(false);
    expect(client.getQueryData(qk.subscriptionGrants('sub-1'))).toEqual([{ id: 'existing' }]);
    client.clear();
  });
});
