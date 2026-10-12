import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import type { MediaProfile } from '@/features/admin/use-media-config';
import MediaModelsPage from './page';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api-client')>(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const profile: MediaProfile = {
  profileId: 'image-basic', kind: 'image', displayName: 'Basic Image', modelId: 'image-model',
  configVersion: 'version-7', operations: ['generate'], executionMode: 'sync-response',
  capabilities: { supportsReferenceImage: false, maxOutputs: 1, sizes: ['1024x1024'] }, enabled: false, verified: false,
};
const connection = { baseUrl: 'https://relay.example/v1', apiKeyConfigured: true, configured: true };

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (path) => path === '/admin/media/profiles' ? [profile] : connection);
  vi.mocked(api.post).mockResolvedValue(profile);
  vi.mocked(api.patch).mockResolvedValue(profile);
  vi.mocked(api.put).mockResolvedValue(connection);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MediaModelsPage /></QueryClientProvider>);
}

async function openCreate() {
  await screen.findByText('Basic Image');
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Profile ID'), { target: { value: 'new-image' } });
  fireEvent.change(within(dialog).getByLabelText('显示名称'), { target: { value: 'New Image' } });
  fireEvent.change(within(dialog).getByLabelText('Model ID'), { target: { value: 'new-model' } });
  return dialog;
}

describe('platform media configuration page', () => {
  it('keeps a configured key blank/password and saving never tests a model', async () => {
    renderPage();
    const input = await screen.findByLabelText(/API Key/);
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/media/connection', { baseUrl: connection.baseUrl }));
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('clears a newly saved mock key after saving', async () => {
    renderPage();
    const input = await screen.findByLabelText(/API Key/);
    fireEvent.change(input, { target: { value: 'mock-only-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(api.put).toHaveBeenCalledWith('/admin/media/connection', { baseUrl: connection.baseUrl, apiKey: 'mock-only-key' });
  });

  it('opens a create dialog and sends legal sizes without server-owned fields', async () => {
    renderPage();
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByLabelText('支持尺寸'), { target: { value: '1024x1024, 1536x1024' } });
    expect(within(dialog).getByLabelText('支持尺寸')).toHaveValue('1024x1024, 1536x1024');
    expect(within(dialog).queryByLabelText(/verified|configVersion/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/media/profiles', {
      profileId: 'new-image', kind: 'image', displayName: 'New Image', modelId: 'new-model',
      operations: ['generate'], executionMode: 'sync-response',
      capabilities: { supportsReferenceImage: false, maxOutputs: 1, sizes: ['1024x1024', '1536x1024'] }, enabled: false,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('allows configuring reference-image support for edit operations', async () => {
    renderPage();
    const dialog = await openCreate();
    fireEvent.click(within(dialog).getByLabelText('edit'));
    fireEvent.click(within(dialog).getByLabelText('支持参考图'));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/media/profiles', expect.objectContaining({
      operations: ['generate', 'edit'], capabilities: expect.objectContaining({ supportsReferenceImage: true }),
    })));
  });

  it.each(['', '1024X1024', '0x1024'])('keeps the dialog and displays a validation error for invalid sizes (%j)', async (sizes) => {
    renderPage();
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByLabelText('支持尺寸'), { target: { value: sizes } });
    fireEvent.submit(within(dialog).getByRole('button', { name: '保存' }).closest('form')!);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('capabilities.sizes');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('edits with the current version and excludes profileId/kind/configVersion/verified from PATCH', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '编辑 Basic Image' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Profile ID')).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('显示名称'), { target: { value: 'Updated Image' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/media/profiles/image-basic', {
      expectedConfigVersion: 'version-7', displayName: 'Updated Image', modelId: profile.modelId,
      operations: profile.operations, executionMode: profile.executionMode, capabilities: profile.capabilities, enabled: false,
    }));
  });

  it('passes the current version when toggling enabled and reports failures', async () => {
    vi.mocked(api.patch).mockRejectedValue(new ApiError(409, '配置版本已变更'));
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: '启用 Basic Image' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/media/profiles/image-basic', {
      expectedConfigVersion: 'version-7', enabled: true,
    }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('配置版本已变更'));
    expect(screen.getByRole('switch', { name: '启用 Basic Image' })).toHaveAttribute('aria-checked', 'false');
  });

  it('renders loading, errors with retry and profile empty states', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(503, '配置加载失败'));
    renderPage();
    expect(screen.getByRole('status', { name: '加载媒体连接' })).toBeInTheDocument();
    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    vi.mocked(api.get).mockImplementation(async (path) => path === '/admin/media/profiles' ? [] : connection);
    for (const button of screen.getAllByRole('button', { name: '重试' })) fireEvent.click(button);
    await screen.findByText('暂无图片 Profile');
    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
  });

  it('preserves entered connection values on a save failure', async () => {
    vi.mocked(api.put).mockRejectedValue(new ApiError(400, '媒体连接无效'));
    renderPage();
    const input = await screen.findByLabelText(/API Key/);
    fireEvent.change(input, { target: { value: 'mock-only-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('媒体连接无效');
    expect(input).toHaveValue('mock-only-key');
  });
});
