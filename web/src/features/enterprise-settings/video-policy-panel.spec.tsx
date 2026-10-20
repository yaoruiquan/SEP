import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { MediaVideoPolicySchema, MediaVideoAvailableProfileSchema } from 'shared/media-video-config.dto';
import fixture from '../../../../backend/src/shared/fixtures/media-video-v1.json';
import { VideoPolicyPanel } from './video-policy-panel';

vi.mock('@/lib/api-client', async (original) => ({ ...await original<typeof import('@/lib/api-client')>(), api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { modelId: _modelId, ...raw } = fixture.profile;
const profile = MediaVideoAvailableProfileSchema.parse({ ...raw, enabled: true, verified: true });
const policy = MediaVideoPolicySchema.parse({ enabledProfileIds: [profile.profileId, 'removed-video'], defaultProfileId: 'removed-video' });
function mockConfig(canEdit = true) {
  vi.mocked(api.get).mockImplementation(async (path) => path === '/enterprise/media-config/video'
    ? { policy, canEdit, configured: true, mock: true, executionTested: false } : [profile]);
}
function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><VideoPolicyPanel /></QueryClientProvider>);
}
afterEach(() => { cleanup(); useAuthStore.getState().clear(); });
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.getState().setAuth({ token: 'mock', user: { id: 'a', email: 'a@example.invalid', name: '视频管理员', avatar: null, role: 'USER' }, enterprise: { id: 'a', name: '视频企业' }, roleInEnterprise: 'ENTERPRISE_ADMIN' });
  mockConfig();
  vi.mocked(api.put).mockResolvedValue({ policy, configured: true, canEdit: true, mock: true, executionTested: false });
});

describe('video policy panel', () => {
  it('removes unavailable selections, clears their default and saves specs to video only', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('checkbox', { name: /removed-video/ }));
    expect(screen.getByLabelText('默认视频 Profile')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('视频最大时长（秒）'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('视频最大并发任务'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/视频周期预算/), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '保存视频策略' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/enterprise/media-config/video', { ...policy, enabledProfileIds: [profile.profileId], defaultProfileId: null, maxDurationSeconds: 10, maxConcurrentJobs: 2, periodBudget: 25 }));
  });
  it.each(['MEMBER', 'DEPT_MANAGER'])('keeps %s read only even when server canEdit is true', async (roleInEnterprise) => {
    useAuthStore.setState({ roleInEnterprise });
    renderPanel();
    await screen.findByText('当前为只读视图，视频授权由企业管理员维护。');
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(screen.getByLabelText('默认视频 Profile')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '保存视频策略' })).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: '视频授权策略' }));
    expect(api.put).not.toHaveBeenCalled();
  });
  it('respects server canEdit=false', async () => {
    mockConfig(false);
    renderPanel();
    await screen.findByText('当前为只读视图，视频授权由企业管理员维护。');
    expect(screen.getByLabelText('视频最大时长（秒）')).toBeDisabled();
  });
  it('shows shared validation failure and keeps edits', async () => {
    renderPanel();
    const input = await screen.findByLabelText('视频最大时长（秒）');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '保存视频策略' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('maxDurationSeconds');
    expect(input).toHaveValue(0);
    expect(api.put).not.toHaveBeenCalled();
  });
  it('keeps form values after a save error', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, '视频策略不合法'));
    renderPanel();
    const input = await screen.findByLabelText('视频最大时长（秒）');
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '保存视频策略' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('视频策略不合法');
    expect(input).toHaveValue(10);
  });
  it('shows loading, failure and supports retry', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(503, '视频服务未开放'));
    renderPanel();
    expect(screen.getByRole('status', { name: '加载视频授权' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('视频服务未开放');
    mockConfig();
    fireEvent.click(screen.getByRole('button', { name: '重试视频授权' }));
    await screen.findByRole('button', { name: '保存视频策略' });
  });
  it('shows an unconfigured empty state', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => path === '/enterprise/media-config/video' ? { policy: MediaVideoPolicySchema.parse({}), canEdit: true, configured: false, mock: true, executionTested: false } : []);
    renderPanel();
    await screen.findByText('暂无已启用且已校验的视频 Profile');
    expect(screen.getByText(/平台 Mock 视频尚未开放/)).toBeInTheDocument();
  });
});
