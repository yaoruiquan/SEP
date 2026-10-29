import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { MediaProfileWorkflow } from './media-profile-workflow';
import type { MediaProfile } from './use-media-config';
import videoFixture from '../../../../backend/src/shared/fixtures/media-video-v1.json';
import { MediaVideoProfileSchema } from 'shared/media-video.dto';

vi.mock('@/lib/api-client', () => ({ api: { post: vi.fn(), patch: vi.fn() } }));
const profile: MediaProfile = { profileId: 'explicit-image', displayName: 'New model', kind: 'image', modelId: 'new-model',
  configVersion: 'cfg_1', operations: ['generate'], executionMode: 'sync-response', enabled: false, verified: false,
  capabilities: { sizes: ['2048x2048'], maxOutputs: 1, supportsReferenceImage: false } };
const mount = (value?: MediaProfile) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
  <MediaProfileWorkflow kind="image" model={{ modelId: 'new-model', displayName: 'New model' }} profile={value} />
</QueryClientProvider>);
const fillSpec = () => {
  fireEvent.change(screen.getByLabelText('尺寸 size'), { target: { value: '2048x2048' } });
  fireEvent.change(screen.getByLabelText('输出数量'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('质量 quality'), { target: { value: 'ultra' } });
};
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe('explicit media profile management', () => {
  it('creates a disabled profile only after the administrator supplies a model spec and operation', async () => {
    vi.mocked(api.post).mockResolvedValue(profile);
    mount();
    fireEvent.click(screen.getByRole('button', { name: '配置通用 Profile' }));
    expect(screen.getByLabelText('尺寸 size')).toHaveValue('');
    expect(screen.getByLabelText('质量 quality')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Profile ID'), { target: { value: profile.profileId } });
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: profile.displayName } });
    fireEvent.change(screen.getByLabelText('操作'), { target: { value: 'generate' } });
    fillSpec();
    fireEvent.click(screen.getByRole('button', { name: '创建停用 Profile' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/media/profiles', expect.objectContaining({
      modelId: 'new-model', enabled: false, operations: ['generate'], capabilities: { sizes: ['2048x2048'], maxOutputs: 1, supportsReferenceImage: false },
    })));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('uses explicit custom quality for read-only verification without enabling or generating', async () => {
    vi.mocked(api.post).mockResolvedValue({ profile: { ...profile, verified: true }, checkedAt: new Date().toISOString(), executionTested: false });
    mount(profile);
    expect(screen.queryByRole('button', { name: '启用' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '报价校验' }));
    fillSpec();
    fireEvent.click(screen.getByRole('button', { name: '校验报价合同' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/media/profiles/explicit-image/verify', {
      expectedConfigVersion: 'cfg_1', verificationSpec: { size: '2048x2048', count: 1, quality: 'ultra' },
    }));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('enables only an already verified profile using its current config version', async () => {
    vi.mocked(api.patch).mockResolvedValue({ ...profile, verified: true, enabled: true });
    mount({ ...profile, verified: true });
    fireEvent.click(screen.getByRole('button', { name: '启用' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/media/profiles/explicit-image', {
      expectedConfigVersion: 'cfg_1', enabled: true,
    }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps optional video fields omitted when verifying only duration and resolution', async () => {
    const video = MediaVideoProfileSchema.parse({ ...videoFixture.profile, enabled: false, verified: false });
    vi.mocked(api.post).mockResolvedValue({ profile: video, checkedAt: new Date().toISOString(), executionTested: false, mock: false });
    render(<QueryClientProvider client={new QueryClient()}><MediaProfileWorkflow kind="video"
      model={{ modelId: video.modelId, displayName: video.displayName }} profile={video} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: '报价校验' }));
    expect(screen.getByLabelText('音频')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('分辨率'), { target: { value: '1440p' } });
    fireEvent.click(screen.getByRole('button', { name: '校验报价合同' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/admin/media/video/profiles/${video.profileId}/verify`, {
      expectedConfigVersion: video.configVersion, verificationSpec: { durationSeconds: 12, resolution: '1440p' },
    }));
  });
});
