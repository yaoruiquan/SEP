import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import type { MediaPolicy, MediaAvailableProfile } from '@/features/enterprise-settings/use-media-config';
import MediaSettingsPage from './page';
import { MediaVideoPolicySchema } from 'shared/media-video-config.dto';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api-client')>(), api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const policy: MediaPolicy = {
  enabledProfileIds: ['image-basic', 'removed-image'], defaultProfileId: 'removed-image',
  allowedOperations: ['generate'], maxOutputs: 2, maxWidth: 4096, maxHeight: 4096,
};
const profile: MediaAvailableProfile = {
  profileId: 'image-basic', kind: 'image', displayName: 'Basic Image',
  configVersion: 'version-7', operations: ['generate'], executionMode: 'sync-response',
  capabilities: { supportsReferenceImage: false, maxOutputs: 2, sizes: ['1024x1024'] }, enabled: true, verified: true,
};
const emptyPreview = {
  protocolVersion: 2, executionMode: 'real', configured: true, executionAvailable: false,
  defaultProfileId: 'removed-image', defaultProfileValid: false,
  profiles: [{ profileId: 'image-basic', configVersion: 'version-7', status: 'empty-intersection', effectiveProfile: null, reasons: ['size-intersection-empty'] }],
};

function mockConfig(canEdit = true, configured = true) {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/enterprise/media-config/video') return { policy: MediaVideoPolicySchema.parse({}), canEdit, configured, mock: true, executionTested: false };
    if (path === '/enterprise/media-config/video/available-profiles') return [];
    return path === '/enterprise/media-config' ? { policy, canEdit, configured }
      : [profile, { ...profile, profileId: 'unverified', displayName: 'Unverified Image', verified: false }];
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MediaSettingsPage /></QueryClientProvider>);
}

afterEach(() => { cleanup(); useAuthStore.getState().clear(); });
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.getState().setAuth({
    token: 'mock-only-token', user: { id: 'user-a', email: 'test@example.invalid', name: 'Mock', avatar: null, role: 'USER' },
    enterprise: { id: 'enterprise-a', name: 'Mock Enterprise' }, roleInEnterprise: 'ENTERPRISE_ADMIN',
  });
  mockConfig();
  vi.mocked(api.put).mockResolvedValue({ policy, configured: true, canEdit: true });
});

describe('enterprise media configuration page', () => {
  it('lets admins deselect an unavailable profile and clears an unavailable default', async () => {
    renderPage();
    const unavailable = await screen.findByRole('checkbox', { name: /removed-image/ });
    expect(unavailable).toBeChecked();
    expect(screen.queryByText('Unverified Image')).not.toBeInTheDocument();
    fireEvent.click(unavailable);
    expect(screen.queryByRole('checkbox', { name: /removed-image/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('默认 Profile')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/enterprise/media-config', {
      ...policy, enabledProfileIds: ['image-basic'], defaultProfileId: null,
    }));
  });

  it('saves image fields when the loaded policy also contains video authorization', async () => {
    const video = MediaVideoPolicySchema.parse({
      enabledProfileIds: ['video-basic'], defaultProfileId: 'video-basic', periodBudget: 100,
    });
    const combinedPolicy = { ...policy, video };
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/enterprise/media-config'
      ? { policy: combinedPolicy, canEdit: true, configured: true } : get(path, options));
    vi.mocked(api.put).mockResolvedValue({ policy: { ...combinedPolicy, maxOutputs: 3 }, canEdit: true, configured: true });
    renderPage();
    fireEvent.change(await screen.findByLabelText('授权最大输出数'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledExactlyOnceWith('/enterprise/media-config', {
      ...policy, maxOutputs: 3,
    }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('授权最大输出数')).toHaveValue(3);
    expect(combinedPolicy.video).toEqual(video);
  });

  it.each(['MEMBER', 'DEPT_MANAGER'])('keeps %s read-only even if the server reports canEdit', async (roleInEnterprise) => {
    useAuthStore.setState({ roleInEnterprise });
    renderPage();
    await screen.findByText('当前为只读视图，图片策略由企业管理员维护。');
    expect(screen.queryByRole('button', { name: '保存策略' })).not.toBeInTheDocument();
    for (const input of screen.getAllByRole('checkbox')) expect(input).toBeDisabled();
    expect(screen.getByLabelText('默认 Profile')).toBeDisabled();
    expect(screen.getByLabelText('授权最大宽度')).toBeDisabled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('respects server canEdit=false for enterprise admins', async () => {
    mockConfig(false);
    renderPage();
    await screen.findByText('当前为只读视图，图片策略由企业管理员维护。');
    expect(screen.queryByRole('button', { name: '保存策略' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /removed-image/ })).toBeDisabled();
  });

  it('renders an unconfigured connection and an empty profile list', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => path === '/enterprise/media-config'
      ? { policy: { ...policy, enabledProfileIds: [], defaultProfileId: null }, configured: false, canEdit: true } : []);
    renderPage();
    await screen.findByText('平台图片连接尚未配置，暂时没有可用的图片 Profile。');
    expect(screen.getByText('暂无已验证且可用的图片 Profile')).toBeInTheDocument();
  });

  it('allows an intentionally empty operation authorization', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('generate'));
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/enterprise/media-config', { ...policy, allowedOperations: [] }));
  });

  it('shows Chinese preview reasons, allows saving an empty intersection and hides results after editing', async () => {
    vi.mocked(api.post).mockResolvedValue(emptyPreview);
    renderPage();
    await screen.findByLabelText('授权最大宽度');
    fireEvent.click(screen.getAllByRole('button', { name: '预览当前授权' })[0]);
    expect(await screen.findByText('授权宽高内没有当前支持的尺寸')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存策略' })).toBeEnabled();
    expect(api.post).toHaveBeenCalledWith('/enterprise/media-config/preview', { protocolVersion: 2, policy });
    fireEvent.change(screen.getByLabelText('授权最大宽度'), { target: { value: '20000' } });
    expect(screen.queryByLabelText('授权预览结果')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/enterprise/media-config', { ...policy, maxWidth: 20000 }));
  });

  it('keeps saving available during preview and after a preview failure', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    renderPage();
    await screen.findByLabelText('授权最大输出数');
    fireEvent.click(screen.getAllByRole('button', { name: '预览当前授权' })[0]);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('授权最大输出数')).toBeEnabled();
    expect(screen.getByRole('button', { name: '保存策略' })).toBeEnabled();
    await act(async () => { reject(new ApiError(503, '预览暂时不可用')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('仍可保存授权');
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  });

  it('does not show a late preview from a different enterprise', async () => {
    let resolve!: (value: typeof emptyPreview) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((finish) => { resolve = finish; }));
    renderPage();
    await screen.findByLabelText('授权最大输出数');
    fireEvent.click(screen.getAllByRole('button', { name: '预览当前授权' })[0]);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    act(() => useAuthStore.setState({ enterprise: { id: 'enterprise-b', name: 'Enterprise B' } }));
    await screen.findByLabelText('授权最大输出数');
    await act(async () => { resolve(emptyPreview); });
    expect(screen.queryByLabelText('授权预览结果')).not.toBeInTheDocument();
  });

  it('allows saving when the capability directory fails', async () => {
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === '/enterprise/media-config/available-profiles') throw new ApiError(503, '目录不可用');
      return get(path, options);
    });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('仍可保存授权');
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  });

  it('shows loading and permits retry after a query failure', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(503, '图片配置不可用'));
    renderPage();
    expect(screen.getByRole('status', { name: '加载图片配置' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('图片配置不可用');
    mockConfig();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: '保存策略' })).toBeInTheDocument();
  });

  it('shows save errors without discarding edited values', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, '图片策略不合法'));
    renderPage();
    const input = await screen.findByLabelText('授权最大输出数');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('图片策略不合法');
    expect(input).toHaveValue(3);
  });
});
