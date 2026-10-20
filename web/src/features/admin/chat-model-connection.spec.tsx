import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { ChatModelConnection } from './chat-model-connection';

vi.mock('@/lib/api-client', async (original) => ({ ...await original<typeof import('@/lib/api-client')>(), api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue([
    { key: 'SUB2API_BASE_URL', value: 'https://chat.example/v1', source: 'environment', configured: true },
    { key: 'SUB2API_API_KEY', value: '', source: 'environment', secret: true, configured: true },
    { key: 'MEDIA_BASE_URL', value: 'https://image.example/v1', configured: true },
  ]);
  vi.mocked(api.put).mockResolvedValue([]);
});
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ChatModelConnection/></QueryClientProvider>); }

it('keeps existing chat key and writes only chat settings', async () => {
  mount();
  await waitFor(() => expect(screen.getByLabelText('Base URL')).toHaveValue('https://chat.example/v1'));
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://new-chat.example/v1' } });
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/settings', { SUB2API_BASE_URL: 'https://new-chat.example/v1' }));
  expect(screen.getByLabelText(/API Key/)).toHaveValue('');
});

it('keeps the form usable when the settings read fails', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('unavailable'));
  mount();
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://fixed-chat.example/v1' } });
  fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'new-chat-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/settings', { SUB2API_BASE_URL: 'https://fixed-chat.example/v1', SUB2API_API_KEY: 'new-chat-key' }));
});
