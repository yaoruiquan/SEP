import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { CreateMediaVideoProfileDtoSchema, UpdateMediaVideoProfileDtoSchema } from 'shared/media-video-config.dto';
import fixture from '../../../../backend/src/shared/fixtures/media-video-v1.json';
import {
  CreateVideoProfileSchema, UpdateVideoProfileSchema, adminVideoProfilesKey,
  useCreateVideoProfile, useDiscoverVideoModels, useUpdateVideoProfile, useVerifyVideoProfile, useVideoProfiles,
  type CreateMediaVideoProfileDto,
} from './use-video-config';

vi.mock('@/lib/api-client', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const { configVersion: _version, verified: _verified, ...raw } = fixture.profile;
const dto = CreateVideoProfileSchema.parse({ ...raw, modelId: 'mock-video-v1' });
const profile = { ...dto, configVersion: 'v1', verified: false };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.post).mockResolvedValue(profile); vi.mocked(api.patch).mockResolvedValue(profile); });

describe('admin video hooks', () => {
  it('reuses shared schemas with their refinements', () => {
    expect(CreateVideoProfileSchema).toBe(CreateMediaVideoProfileDtoSchema);
    expect(UpdateVideoProfileSchema).toBe(UpdateMediaVideoProfileDtoSchema);
  });
  it('loads video only with an independent cache', async () => {
    vi.mocked(api.get).mockResolvedValue([profile]);
    const { client, wrapper } = setup();
    const { result } = renderHook(useVideoProfiles, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/admin/media/video/profiles');
    expect(client.getQueryData(adminVideoProfilesKey)).toEqual([profile]);
    expect(client.getQueryData(qk.adminMediaProfiles)).toBeUndefined();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('always imports disabled without client verification/version', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(useCreateVideoProfile, { wrapper });
    await act(async () => { await result.current.mutateAsync({ ...dto, enabled: true }); });
    expect(api.post).toHaveBeenCalledWith('/admin/media/video/profiles', dto);
  });
  it.each([
    { verified: true }, { configVersion: 'forged' }, { kind: 'image' },
    { capabilities: { ...dto.capabilities, durationsSeconds: [] } },
    { capabilities: { ...dto.capabilities, supportsImageToVideo: false } },
  ])('rejects invalid input before sending %j', async (override) => {
    const { wrapper } = setup();
    const { result } = renderHook(useCreateVideoProfile, { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ ...dto, ...override } as CreateMediaVideoProfileDto)).rejects.toBeDefined(); });
    expect(api.post).not.toHaveBeenCalled();
  });
  it('discovers using an empty body and validates the mock-only response', async () => {
    vi.mocked(api.post).mockResolvedValue({ checkedAt: new Date().toISOString(), mock: true, executionTested: false, models: [] });
    const { wrapper } = setup();
    const { result } = renderHook(useDiscoverVideoModels, { wrapper });
    await act(async () => { await result.current.mutateAsync(); });
    expect(api.post).toHaveBeenCalledWith('/admin/media/video/models/discover', {});
    vi.mocked(api.post).mockResolvedValue({ checkedAt: new Date().toISOString(), mock: false, executionTested: true, models: [] });
    await act(async () => { await expect(result.current.mutateAsync()).rejects.toBeDefined(); });
  });
  it.each(['update', 'verify'] as const)('%s sends a version and invalidates video caches only', async (action) => {
    vi.mocked(api.post).mockResolvedValue({ profile: { ...profile, verified: true }, checkedAt: new Date().toISOString(), executionTested: false, mock: true });
    const { client, wrapper } = setup();
    const keys = [['enterprise', 'a', 'video-config'], ['enterprise', 'b', 'available-video-profiles'], qk.mediaConfig('a'), qk.modelConfig('a'), qk.adminMediaProfiles];
    for (const key of keys) client.setQueryData(key, {});
    const { result } = renderHook(() => ({ update: useUpdateVideoProfile(), verify: useVerifyVideoProfile() }), { wrapper });
    await act(async () => {
      if (action === 'update') await result.current.update.mutateAsync({ profileId: 'video/a', dto: { expectedConfigVersion: 'v1', enabled: true } });
      else await result.current.verify.mutateAsync({ profileId: 'video/a', dto: { expectedConfigVersion: 'v1' } });
    });
    if (action === 'update') expect(api.patch).toHaveBeenCalledWith('/admin/media/video/profiles/video%2Fa', { expectedConfigVersion: 'v1', enabled: true });
    else expect(api.post).toHaveBeenCalledWith('/admin/media/video/profiles/video%2Fa/verify', { expectedConfigVersion: 'v1' });
    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([true, true, false, false, false]);
  });
  it('rejects updates lacking a version or writable changes', async () => {
    expect(UpdateVideoProfileSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(UpdateVideoProfileSchema.safeParse({ expectedConfigVersion: 'v1' }).success).toBe(false);
  });
});
