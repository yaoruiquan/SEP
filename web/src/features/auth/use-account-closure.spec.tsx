import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api-client';
import {
  useAccountClosureEligibility,
  useCancelAccountClosure,
  useSubmitAccountClosure,
} from './use-auth';

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, wrapper: Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    token: 'access',
    user: {
      id: 'user',
      email: 'test@example.com',
      name: null,
      avatar: null,
      role: 'USER',
    },
    enterprise: null,
  });
});

it('does not query eligibility before identity is restored', () => {
  renderHook(() => useAccountClosureEligibility(false), setup());
  expect(api.get).not.toHaveBeenCalled();
});

it('clears all identity and cached tenant data after successful submission', async () => {
  vi.mocked(api.post).mockResolvedValue({
    requestId: 'request',
    status: 'PENDING',
    scheduledFor: '2026-10-30T01:00:00Z',
  });
  const options = setup();
  options.client.setQueryData(['tenant-secrets'], 'cached');
  const { result } = renderHook(() => useSubmitAccountClosure(), options);
  await act(async () =>
    result.current.mutateAsync({
      token: 'a'.repeat(32),
      confirmation: '注销账号',
    }),
  );
  expect(useAuthStore.getState().token).toBeNull();
  expect(useAuthStore.getState().user).toBeNull();
  expect(options.client.getQueryData(['tenant-secrets'])).toBeUndefined();
  expect(api.post).toHaveBeenCalledWith(
    '/auth/account-closure',
    { token: 'a'.repeat(32), confirmation: '注销账号' },
    { skipAuthRetry: true },
  );
});

it('retains identity and cache when submission fails', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('refused'));
  const options = setup();
  options.client.setQueryData(['tenant-secrets'], 'cached');
  const { result } = renderHook(() => useSubmitAccountClosure(), options);
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        token: 'a'.repeat(32),
        confirmation: '注销账号',
      }),
    ).rejects.toThrow('refused');
  });
  expect(useAuthStore.getState().token).toBe('access');
  expect(options.client.getQueryData(['tenant-secrets'])).toBe('cached');
});

it('cancels without refreshing or logging in a user', async () => {
  vi.mocked(api.post).mockResolvedValue({
    message: '注销申请已撤销，请重新登录',
  });
  useAuthStore.getState().clear();
  const { result } = renderHook(() => useCancelAccountClosure(), setup());
  act(() => result.current.mutate('b'.repeat(32)));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api.post).toHaveBeenCalledWith(
    '/auth/account-closure/cancel',
    { token: 'b'.repeat(32) },
    { skipAuthRetry: true },
  );
  expect(useAuthStore.getState().user).toBeNull();
});
