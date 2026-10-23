import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResendInvitation } from '../use-enterprise';
import { qk } from '@/lib/query-keys';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ api: { post: mocks.post } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('invitation mutations', () => {
  it('refreshes every invitation list filter and keeps the new token out of list caches', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(qk.invitations(), [{ id: 'inv-1', emailStatus: 'FAILED' }]);
    client.setQueryData(qk.invitations('PENDING'), [{ id: 'inv-1', emailStatus: 'FAILED' }]);
    const response = { id: 'inv-1', emailStatus: 'SENT', token: 'one-time-token', invitationUrl: 'https://sep.example/join?token=one-time-token' };
    mocks.post.mockResolvedValue(response);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useResendInvitation(), { wrapper });

    await act(async () => {
      expect(await result.current.mutateAsync('inv-1')).toEqual(response);
    });

    expect(mocks.post).toHaveBeenCalledWith('/enterprise/invitations/inv-1/resend', {});
    expect(client.getQueryState(qk.invitations())?.isInvalidated).toBe(true);
    expect(client.getQueryState(qk.invitations('PENDING'))?.isInvalidated).toBe(true);
    expect(JSON.stringify(client.getQueryData(qk.invitations()))).not.toContain('one-time-token');
    client.clear();
  });
});
