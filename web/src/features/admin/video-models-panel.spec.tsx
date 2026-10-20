import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { CreateVideoProfileSchema, type MediaVideoProfile } from './use-video-config';
import fixture from '../../../../backend/src/shared/fixtures/media-video-v1.json';
import { VideoModelsPanel } from './video-models-panel';

vi.mock('@/lib/api-client', async (original) => ({ ...await original<typeof import('@/lib/api-client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { configVersion: _version, verified: _verified, ...raw } = fixture.profile;
const dto = CreateVideoProfileSchema.parse({ ...raw, modelId: 'mock-video-v1' });
let profiles: MediaVideoProfile[];
const candidate = { modelId: dto.modelId, displayName: dto.displayName, compatible: true, reason: null, suggested: { operations: dto.operations, executionMode: dto.executionMode, capabilities: dto.capabilities } };
function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><VideoModelsPanel /></QueryClientProvider>);
}
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  profiles = [{ ...dto, configVersion: 'v1', verified: false }];
  vi.mocked(api.get).mockImplementation(async () => structuredClone(profiles));
  vi.mocked(api.post).mockImplementation(async (path) => {
    if (path.endsWith('/discover')) return { checkedAt: new Date().toISOString(), mock: true, executionTested: false, models: [candidate, { ...candidate, modelId: 'real-video', displayName: 'Real video', compatible: false, reason: '真实模型尚未适配' }] };
    if (path.endsWith('/verify')) {
      profiles = profiles.map((profile) => ({ ...profile, verified: true, configVersion: 'v2' }));
      return { profile: profiles[0], checkedAt: new Date().toISOString(), executionTested: false, mock: true };
    }
    return profiles[0];
  });
  vi.mocked(api.patch).mockResolvedValue({});
});

describe('video models panel', () => {
  it('discovers, imports disabled, verifies then enables using the refreshed version', async () => {
    renderPanel();
    await screen.findByRole('button', { name: `校验视频 ${dto.displayName}` });
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Mock · 不计费')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发现视频模型' }));
    fireEvent.click(await screen.findByRole('button', { name: `导入视频模型 ${dto.displayName}` }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存视频配置' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith('/admin/media/video/profiles', expect.objectContaining({ enabled: false, modelId: 'mock-video-v1' }));
    fireEvent.click(screen.getByRole('button', { name: `校验视频 ${dto.displayName}` }));
    await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
    expect(api.post).toHaveBeenCalledWith(`/admin/media/video/profiles/${dto.profileId}/verify`, { expectedConfigVersion: 'v1' });
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`/admin/media/video/profiles/${dto.profileId}`, { expectedConfigVersion: 'v2', enabled: true }));
    expect(vi.mocked(api.post).mock.calls.every(([path]) => path.startsWith('/admin/media/video/'))).toBe(true);
  });
  it('allows importing a real candidate but blocks verification and enabling', async () => {
    profiles = [{ ...dto, modelId: 'real-video', verified: true, configVersion: 'v1' }];
    renderPanel();
    await screen.findByText('真实模型未适配，不可启用');
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: `校验视频 ${dto.displayName}` })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '发现视频模型' }));
    fireEvent.click(await screen.findByRole('button', { name: '导入视频模型 Real video' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存视频配置' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/media/video/profiles', expect.objectContaining({ modelId: 'real-video', enabled: false })));
  });
  it('shows shared validation errors and keeps imported values', async () => {
    renderPanel();
    await screen.findByText(dto.displayName);
    fireEvent.click(screen.getByRole('button', { name: '发现视频模型' }));
    fireEvent.click(await screen.findByRole('button', { name: `导入视频模型 ${dto.displayName}` }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('视频时长（秒）'), { target: { value: '0' } });
    fireEvent.click(dialog.getByRole('button', { name: '保存视频配置' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('durationsSeconds');
    expect(dialog.getByLabelText('视频时长（秒）')).toHaveValue('0');
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('edits a profile with its version and disables it for revalidation', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: `编辑视频 ${dto.displayName}` }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('视频 Profile ID')).toBeDisabled();
    fireEvent.change(dialog.getByLabelText('视频显示名称'), { target: { value: '视频演示' } });
    fireEvent.click(dialog.getByRole('button', { name: '保存视频配置' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`/admin/media/video/profiles/${dto.profileId}`, expect.objectContaining({ expectedConfigVersion: 'v1', enabled: false, displayName: '视频演示' })));
  });
  it('shows load errors and permits retry, then empty state', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(503, '视频配置不可用'));
    renderPanel();
    expect(screen.getByRole('status', { name: '加载视频 Profiles' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('视频配置不可用');
    vi.mocked(api.get).mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: '重试视频配置' }));
    await screen.findByText('暂无视频 Profile，请先发现并导入模型。');
  });
  it('displays a verification conflict without enabling stale configuration', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, '视频版本已变化，请刷新'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: `校验视频 ${dto.displayName}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('视频版本已变化');
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
