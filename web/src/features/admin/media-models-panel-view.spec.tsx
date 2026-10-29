import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { MediaModelsPanelView } from './media-models-panel-view';

vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Props = ComponentProps<typeof MediaModelsPanelView>;
const connection = { baseUrl: 'https://relay.example/v1', configured: true, apiKeyConfigured: true };
function props(): Props {
  return {
    kind: 'image', connection: { data: connection, isLoading: false, error: null, refetch: vi.fn() },
    save: { isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) },
    discovery: { isPending: false, error: null, reset: vi.fn(), mutate: vi.fn() },
    profiles: { data: [], isLoading: false, error: null }, updating: false, onDisable: vi.fn(),
  };
}
afterEach(cleanup);

describe('media connection drafts', () => {
  it('shows asynchronously loaded connection data and later refetches while the form is clean', () => {
    const input = props();
    const { rerender } = render(<MediaModelsPanelView {...input} connection={{ ...input.connection, data: undefined, isLoading: true }} />);
    expect(screen.getByLabelText('Base URL')).toHaveValue('');
    rerender(<MediaModelsPanelView {...input} />);
    expect(screen.getByLabelText('Base URL')).toHaveValue(connection.baseUrl);
    rerender(<MediaModelsPanelView {...input} connection={{ ...input.connection, data: { ...connection, baseUrl: 'https://refetched.example/v1' } }} />);
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://refetched.example/v1');
    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
    expect(screen.getByRole('button', { name: '检测并同步' })).toBeEnabled();
  });

  it('keeps both draft fields when the connection refetches after editing', () => {
    const input = props();
    const { rerender } = render(<MediaModelsPanelView {...input} />);
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://draft.example/v1' } });
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'draft-key' } });
    rerender(<MediaModelsPanelView {...input} connection={{ ...input.connection, data: { ...connection, baseUrl: 'https://refetched.example/v1' } }} />);
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://draft.example/v1');
    expect(screen.getByLabelText(/API Key/)).toHaveValue('draft-key');
    expect(screen.getByRole('button', { name: '检测并同步' })).toBeDisabled();
  });

  it('preserves drafts entered before the initial connection resolves', () => {
    const input = props();
    const { rerender } = render(<MediaModelsPanelView {...input} connection={{ ...input.connection, data: undefined, isLoading: true }} />);
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://draft.example/v1' } });
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'draft-key' } });
    rerender(<MediaModelsPanelView {...input} />);
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://draft.example/v1');
    expect(screen.getByLabelText(/API Key/)).toHaveValue('draft-key');
  });

  it('keeps the draft and key after a failed save so it can be retried', async () => {
    const input = props();
    vi.mocked(input.save.mutateAsync).mockRejectedValue(new ApiError(503, '保存暂不可用'));
    render(<MediaModelsPanelView {...input} />);
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://draft.example/v1' } });
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'draft-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存暂不可用');
    expect(input.save.mutateAsync).toHaveBeenCalledWith({ baseUrl: 'https://draft.example/v1', apiKey: 'draft-key' });
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://draft.example/v1');
    expect(screen.getByLabelText(/API Key/)).toHaveValue('draft-key');
    expect(screen.getByRole('button', { name: '检测并同步' })).toBeDisabled();
  });

  it('clears the key after a successful save and resumes showing refreshed connection data', async () => {
    const input = props();
    let finish!: (value: unknown) => void;
    vi.mocked(input.save.mutateAsync).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { rerender } = render(<MediaModelsPanelView {...input} />);
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://saved.example/v1' } });
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'new-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(input.save.mutateAsync).toHaveBeenCalledTimes(1));
    rerender(<MediaModelsPanelView {...input} connection={{ ...input.connection, data: { ...connection, baseUrl: 'https://saved.example/v1' } }} />);
    expect(screen.getByLabelText(/API Key/)).toHaveValue('new-key');
    await act(async () => { finish(undefined); });
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://saved.example/v1');
    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
    expect(screen.getByRole('button', { name: '检测并同步' })).toBeEnabled();
    rerender(<MediaModelsPanelView {...input} connection={{ ...input.connection, data: { ...connection, baseUrl: 'https://later.example/v1' } }} />);
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://later.example/v1');
  });
});
