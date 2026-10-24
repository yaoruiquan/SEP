import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import fixture from 'shared/fixtures/media-video-v1.json';
import { ImageModelsPanel } from './image-models-panel';
import { VideoModelsPanel } from './video-models-panel';

vi.mock('@/lib/api-client', async (original) => ({ ...await original<typeof import('@/lib/api-client')>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

describe.each(['image', 'video'] as const)('%s model configuration boundaries', (kind) => {
  const prefix = kind === 'image' ? '/admin/media' : '/admin/media/video';
  const profile = kind === 'image' ? {
    profileId: 'image-a', kind, displayName: '受限配置 A', modelId: 'gpt-image-2', configVersion: 'cfg_a',
    operations: ['generate'], executionMode: 'sync-response',
    capabilities: { supportsReferenceImage: false, maxOutputs: 1, sizes: ['1024x1024'] }, enabled: true, verified: true,
  } : { ...fixture.profile, profileId: 'video-a', modelId: 'minimax-h3', displayName: '受限配置 A', configVersion: 'cfg_a', enabled: true, verified: true };
  let rows: typeof profile[];
  const connection = { baseUrl: `https://${kind}.example/v1`, apiKeyConfigured: true, configured: true, source: 'environment' };
  function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}>{kind === 'image' ? <ImageModelsPanel/> : <VideoModelsPanel/>}</QueryClientProvider>);
    return client;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [structuredClone(profile)];
    vi.mocked(api.get).mockImplementation(async (path) => path.endsWith('/connection') ? connection : rows);
    vi.mocked(api.put).mockResolvedValue(connection);
    vi.mocked(api.patch).mockImplementation(async (path) => {
      rows = rows.map((row) => path.endsWith(row.profileId) ? { ...row, enabled: false } : row);
      return rows[0];
    });
    vi.mocked(api.post).mockResolvedValue({ checkedAt: '2026-10-20T08:00:00Z',
      ...(kind === 'video' ? { mock: false, executionTested: false } : {}),
      models: [{ modelId: 'unadapted-model', displayName: '旧渠道候选', compatible: false, reason: '未适配', suggested: null }],
    });
  });

  it('shows existing verified state on reload and preserves multiple historical configurations', async () => {
    rows.push({ ...profile, profileId: 'history-b', displayName: '受限配置 B', configVersion: 'cfg_b' });
    mount();
    expect(await screen.findByText('受限配置 A')).toBeInTheDocument();
    expect(screen.getByText('受限配置 B')).toBeInTheDocument();
    expect(screen.getAllByText('已适配')).toHaveLength(2);
    expect(screen.getByText('来源：环境变量')).toBeInTheDocument();
    const second = screen.getByText('受限配置 B').closest('li')!;
    fireEvent.click(within(second).getByRole('button', { name: '紧急停用' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${prefix}/profiles/history-b`, { enabled: false, expectedConfigVersion: 'cfg_b' }));
    await waitFor(() => expect(within(second).getByText('已停用')).toBeInTheDocument());
    expect(within(screen.getByText('受限配置 A').closest('li')!).getByText('启用中')).toBeInTheDocument();
  });

  it('shows each profile capability snapshot without implying real generation verification', async () => {
    mount();
    const row = (await screen.findByText('受限配置 A')).closest('li')!;
    expect(within(row).getByText('配置版本：cfg_a')).toBeInTheDocument();
    expect(within(row).getByText('Profile 来源：人工配置')).toBeInTheDocument();
    expect(within(row).getByText('后台适配标记：已标记适配 · 真实生成验收：未提供')).toBeInTheDocument();
    fireEvent.click(within(row).getByText('查看能力详情'));
    if (kind === 'image') {
      expect(within(row).getByText('1024x1024')).toBeInTheDocument();
      expect(within(row).getAllByText('未提供')).toHaveLength(2);
    } else {
      expect(within(row).getByText('9:16')).toBeInTheDocument();
      expect(within(row).getByText('video/mp4')).toBeInTheDocument();
      expect(within(within(row).getByText('输出尺寸 / 字节上限：').parentElement!).getByText('未提供')).toBeInTheDocument();
    }
  });

  it('clears old discovery on edits and after save, requiring a new detection', async () => {
    mount();
    await screen.findByText('受限配置 A');
    fireEvent.click(screen.getByRole('button', { name: '检测并同步' }));
    expect(await screen.findByText('旧渠道候选')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://new.example/v1' } });
    await waitFor(() => expect(screen.queryByText('旧渠道候选')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '检测并同步' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'new-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${prefix}/connection`, { baseUrl: 'https://new.example/v1', apiKey: 'new-key' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '检测并同步' })).toBeEnabled());
    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('prevents saving a different connection while discovery is pending', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mount();
    await screen.findByText('受限配置 A');
    fireEvent.click(screen.getByRole('button', { name: '检测并同步' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存连接' })).toBeDisabled());
    expect(screen.getByLabelText('Base URL')).toBeDisabled();
    finish({ checkedAt: '2026-10-20T08:00:00Z', ...(kind === 'video' ? { mock: false, executionTested: false } : {}), models: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存连接' })).toBeEnabled());
    expect(screen.getByText(/本次目录未发现.*模型，历史配置仍保留/)).toBeInTheDocument();
    expect(screen.getByText('受限配置 A')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});
