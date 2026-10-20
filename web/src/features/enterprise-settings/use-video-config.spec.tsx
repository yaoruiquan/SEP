import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { MediaVideoPolicySchema } from 'shared/media-video-config.dto';
import fixture from '../../../../backend/src/shared/fixtures/media-video-v1.json';
import {
  VideoPolicyFormSchema, availableVideoProfilesKey, videoConfigKey,
  useAvailableVideoProfiles, useEnterpriseVideoConfig, useUpdateEnterpriseVideoConfig,
} from './use-video-config';

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
const { modelId: _modelId, ...raw } = fixture.profile;
const profile = { ...raw, enabled: true, verified: true };
const policy = MediaVideoPolicySchema.parse({ enabledProfileIds: [profile.profileId], defaultProfileId: profile.profileId });
const response = { policy, configured: true, canEdit: true, mock: true, executionTested: false };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe('enterprise video hooks', () => {
  it('reuses shared policy schema', () => { expect(VideoPolicyFormSchema).toBe(MediaVideoPolicySchema); });
  it('does not fetch without an enterprise', () => {
    const { wrapper } = setup();
    renderHook(() => ({ config: useEnterpriseVideoConfig(''), available: useAvailableVideoProfiles('') }), { wrapper });
    expect(api.get).not.toHaveBeenCalled();
  });
  it('isolates enterprise video config from other enterprises and images', async () => {
    vi.mocked(api.get).mockResolvedValue(response);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useEnterpriseVideoConfig('a'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/enterprise/media-config/video');
    expect(client.getQueryData(videoConfigKey('a'))).toEqual(response);
    expect(client.getQueryData(videoConfigKey('b'))).toBeUndefined();
    expect(client.getQueryData(qk.mediaConfig('a'))).toBeUndefined();
  });
  it('offers only enabled and verified video profiles', async () => {
    vi.mocked(api.get).mockResolvedValue([profile, { ...profile, profileId: 'unverified', verified: false }, { ...profile, profileId: 'disabled', enabled: false }]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useAvailableVideoProfiles('a'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([profile]));
    expect(api.get).toHaveBeenCalledWith('/enterprise/media-config/video/available-profiles');
  });
  it('rejects an image response instead of exposing it as video', async () => {
    vi.mocked(api.get).mockResolvedValue([{ ...profile, kind: 'image' }]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useAvailableVideoProfiles('a'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
  it('saves using the video endpoint and refreshes only this enterprise video cache', async () => {
    vi.mocked(api.put).mockResolvedValue(response);
    const { client, wrapper } = setup();
    const keys = [availableVideoProfilesKey('a'), availableVideoProfilesKey('b'), qk.availableMediaProfiles('a'), qk.modelConfig('a')];
    keys.forEach((key) => client.setQueryData(key, []));
    const { result } = renderHook(() => useUpdateEnterpriseVideoConfig('a'), { wrapper });
    await act(async () => { await result.current.mutateAsync(policy); });
    expect(api.put).toHaveBeenCalledWith('/enterprise/media-config/video', policy);
    expect(client.getQueryData(videoConfigKey('a'))).toEqual(response);
    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([true, false, false, false]);
  });
  it('validates specification and operation fields before saving', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateEnterpriseVideoConfig('a'), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ maxDurationSeconds: 0 })).rejects.toBeDefined(); });
    expect(api.put).not.toHaveBeenCalled();
    expect(VideoPolicyFormSchema.safeParse({ ...policy, allowedOperations: ['generate'] }).success).toBe(false);
    expect(VideoPolicyFormSchema.safeParse({ ...policy, periodBudget: -1 }).success).toBe(false);
  });
  it('keeps an in-flight save attached to its original enterprise after identity changes', async () => {
    let finish!: (value: typeof response) => void;
    vi.mocked(api.put).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { client, wrapper } = setup();
    client.setQueryData(availableVideoProfilesKey('a'), []);
    client.setQueryData(availableVideoProfilesKey('b'), []);
    const { result, rerender } = renderHook(({ id }) => useUpdateEnterpriseVideoConfig(id), { wrapper, initialProps: { id: 'a' } });
    act(() => { result.current.mutate(policy); });
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    rerender({ id: 'b' });
    await act(async () => { finish(response); });
    await waitFor(() => expect(client.getQueryData(videoConfigKey('a'))).toEqual(response));
    expect(client.getQueryData(videoConfigKey('b'))).toBeUndefined();
    expect(client.getQueryState(availableVideoProfilesKey('a'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(availableVideoProfilesKey('b'))?.isInvalidated).toBe(false);
  });
});
