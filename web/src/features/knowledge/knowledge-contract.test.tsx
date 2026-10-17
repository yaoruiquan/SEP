import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import { useKnowledgeBases, useKnowledgeBase } from './use-knowledge-bases';
import { useCreateGrant, useDeleteGrant, useGrantableMembers, useKnowledgeGrants } from './use-knowledge-grants';
import { hasDocumentTasks, useDocuments, useDocumentPreview, useDocumentVersions } from './use-documents';
import { useDocumentStatus } from './use-knowledge-test';

vi.mock('@/lib/api-client', async (original) => ({
  ...await original<typeof import('@/lib/api-client')>(),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));

const clients: QueryClient[] = [];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return function QueryWrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}

afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.clearAllMocks(); vi.useRealTimers(); });

describe('knowledge API boundary', () => {
  it('keeps viewer, capabilities and server limits even when the library list is empty', async () => {
    const envelope = { items: [], total: 0, page: 1, pageSize: 20, viewer: { role: 'ADMIN' }, capabilities: { canCreateKnowledgeBase: true }, limits: { maxFileBytes: 42 } };
    vi.mocked(api.get).mockResolvedValue(envelope);
    const { result } = renderHook(() => useKnowledgeBases({ keyword: '  企业 & 产品  ', page: 2 }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/knowledge-bases?page=2&pageSize=20&keyword=%E4%BC%81%E4%B8%9A+%26+%E4%BA%A7%E5%93%81');
    expect(result.current.data).toEqual(envelope);
  });

  it('does not load detail or admin lists until their gates enable them', async () => {
    renderHook(() => {
      useKnowledgeBases({}, false);
      useKnowledgeBase('kb', false);
      useKnowledgeGrants('kb', {}, false);
      useGrantableMembers({}, false);
      useDocuments('kb', false);
    }, { wrapper: wrapper() });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('preserves 403 as an error instead of manufacturing an empty result', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, 'forbidden'));
    const { result } = renderHook(() => useKnowledgeBases(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatchObject({ status: 403 });
  });

  it('uses only the dedicated member projection and member IDs for batch authorization and revocation', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 20 });
    const { result } = renderHook(() => ({
      members: useGrantableMembers({ page: 2, keyword: '张' }),
      grants: useKnowledgeGrants('kb'),
      add: useCreateGrant('kb'), remove: useDeleteGrant('kb'),
    }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.members.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/enterprise/members?view=knowledge-grant&page=2&pageSize=20&keyword=%E5%BC%A0');
    expect(api.get).toHaveBeenCalledWith('/knowledge-bases/kb/grants?page=1&pageSize=20');
    await act(async () => { await result.current.add.mutateAsync({ memberIds: ['member-1', 'member-2'] }); });
    expect(api.post).toHaveBeenCalledWith('/knowledge-bases/kb/grants', { memberIds: ['member-1', 'member-2'] });
    await act(async () => { await result.current.remove.mutateAsync('member-1'); });
    expect(api.delete).toHaveBeenCalledWith('/knowledge-bases/kb/grants/member-1');
  });

  it('keeps paginated processed-chunk previews and surfaces 409 without retrying', async () => {
    const preview = { documentId: 'doc', documentName: '制度', previewKind: 'PROCESSED_CHUNKS', items: [{ chunkId: 'chunk', text: '正文' }], page: 2, pageSize: 20, total: 21 };
    vi.mocked(api.get).mockResolvedValueOnce(preview);
    const { result, rerender } = renderHook(({ doc }) => useDocumentPreview('kb', doc, 2), { initialProps: { doc: 'doc' }, wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(preview);
    expect(api.get).toHaveBeenCalledWith('/knowledge-bases/kb/documents/doc/preview?page=2&pageSize=20');
    vi.mocked(api.get).mockRejectedValue(new ApiError(409, '文档尚未处理完成'));
    rerender({ doc: 'processing' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 409 });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('automatically polls while tasks are active and stops when all documents finish', async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValueOnce([{ id: 'doc', status: 'PROCESSING' }]).mockResolvedValue([{ id: 'doc', status: 'READY' }]);
    const { result } = renderHook(() => useDocuments('kb'), { wrapper: wrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(hasDocumentTasks(result.current.data)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.data?.[0].status).toBe('READY');
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  const pollingHooks = {
    documents: function useDocumentsPolling() { return useDocuments('kb'); },
    versions: function useVersionsPolling() { return useDocumentVersions('kb', 'doc'); },
    status: function useStatusPolling() { return useDocumentStatus('kb'); },
  };
  it.each(Object.keys(pollingHooks) as (keyof typeof pollingHooks)[])('resumes %s polling after a transient failure', async (kind) => {
    vi.useFakeTimers();
    const processing = [{ id: 'doc', status: 'PROCESSING' }];
    const ready = [{ id: 'doc', status: 'READY' }];
    vi.mocked(api.get)
      .mockResolvedValueOnce(kind === 'status' ? { documents: processing } : processing)
      .mockRejectedValueOnce(new ApiError(503, 'temporarily unavailable'))
      .mockResolvedValue(kind === 'status' ? { documents: ready } : ready);
    const usePolling = pollingHooks[kind];
    const { result } = renderHook(() => {
      const query = usePolling();
      return { isError: query.isError, isSuccess: query.isSuccess };
    }, { wrapper: wrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.isError).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.isSuccess).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it.each([403, 404])('stops version polling after access is lost with %i', async (status) => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValueOnce([{ id: 'v2', status: 'PROCESSING' }]).mockRejectedValue(new ApiError(status, 'access lost'));
    const { result } = renderHook(() => useDocumentVersions('kb', 'doc'), { wrapper: wrapper() });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.isError).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
