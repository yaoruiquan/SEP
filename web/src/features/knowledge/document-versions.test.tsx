import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, uploadForm } from '@/lib/api-client';
import type { KnowledgeBase, KnowledgeDocument, KnowledgeLimits } from '@/lib/types';
import { DocumentsPanel } from './documents-panel';
import { DocumentUploader } from './document-uploader';
import { DocumentPreview } from './document-preview';
import { documentOperation, useDeleteDocument, useUploadDocumentVersion } from './use-documents';
import { useReprocessDocument } from './use-knowledge-test';

vi.mock('@/lib/api-client', async (original) => ({
  ...await original<typeof import('@/lib/api-client')>(),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() }, uploadForm: vi.fn(),
}));

const limits: KnowledgeLimits = { allowedExtensions: ['txt'], maxFileBytes: 1024, maxFilesPerRequest: 2, maxQueryCharacters: 1000, maxSearchKnowledgeBases: 100, maxTopK: 20, maxResultTokens: 6000 };
const kb: KnowledgeBase = { id: 'kb', name: '制度', description: '', documentCount: 1, readyDocumentCount: 1, revision: 1, createdAt: '2026-10-16', updatedAt: '2026-10-16', permissions: { canView: true, canSearch: true, canUpload: true, canManage: true, canManageGrants: true } };
const active = { id: 'v1', version: 1, status: 'READY' as const, originalName: '制度.txt', createdAt: '2026-10-16' };
const latest = { ...active, id: 'v2', version: 2, status: 'FAILED' as const, stage: 'EMBEDDING', lastError: '索引暂不可用，请重试', errorCode: 'INDEX_UNAVAILABLE', retryable: true, attempts: 2, processedChunks: 2, totalChunks: 5 };
const etag = `"kbdoc-${'a'.repeat(64)}"`;
const nextEtag = `"kbdoc-${'b'.repeat(64)}"`;
const doc: KnowledgeDocument = { id: 'doc', originalName: '制度.txt', fileSize: 12, mimeType: 'text/plain', status: 'FAILED', revision: 7, etag, searchable: true, activeVersionId: 'v1', latestVersionId: 'v2', activeVersion: active, latestVersion: latest, createdAt: '2026-10-16', updatedAt: '2026-10-16' };
const clients: QueryClient[] = [];
function wrapper(retry = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: retry ? 1 : false, retryDelay: 0 } } });
  clients.push(client);
  return function QueryWrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
function view(node: React.ReactNode) { return render(node, { wrapper: wrapper() }); }
function mockDocument(document = doc) {
  vi.mocked(api.get).mockImplementation(async (path) => path.endsWith('/versions') ? [latest] : path.includes('/preview') ? {
    documentId: 'doc', versionId: 'v1', documentName: '制度.txt', previewKind: 'PROCESSED_CHUNKS', items: [{ chunkId: 'c', text: '旧生效版本正文' }], page: 1, pageSize: 20, total: 21,
  } : path.endsWith('/doc') ? document : [document]);
}

beforeEach(() => {
  mockDocument();
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.resetAllMocks(); vi.useRealTimers(); });

describe('document versions', () => {
  it('shows latest failure and progress while previewing the old searchable active version', async () => {
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    expect(await screen.findByText('生效版本：v1 · 最新版本：v2')).toBeInTheDocument();
    expect(screen.getByText('索引暂不可用，请重试')).toBeInTheDocument();
    expect(screen.getByText('处理阶段：生成索引')).toBeInTheDocument();
    expect(screen.getByText('已处理 2 / 5 个片段')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试 制度.txt' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '预览 制度.txt' }));
    expect(await screen.findByText('旧生效版本正文')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/knowledge-bases/kb/documents/doc/preview?page=1&pageSize=20&versionId=v1');
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path.endsWith('/status'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/knowledge-bases/kb/documents/doc/preview?page=2&pageSize=20&versionId=v1'));
  });

  it('hides retry for nonretryable failures and disables preview without a searchable active version', async () => {
    vi.mocked(api.get).mockResolvedValue([{ ...doc, searchable: false, activeVersionId: null, activeVersion: null, latestVersion: { ...latest, retryable: false } }]);
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    expect(await screen.findByRole('button', { name: '预览 制度.txt' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '重试 制度.txt' })).not.toBeInTheDocument();
  });

  it('allows legacy FAILED documents to retry and safely surfaces backend rejection', async () => {
    mockDocument({ ...doc, latestVersionId: null, latestVersion: null });
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, 'not retryable'));
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '重试 制度.txt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请重新确认是否重试');
    expect(api.post).toHaveBeenCalledWith('/knowledge-bases/kb/documents/doc/reprocess', {}, { headers: { 'If-Match': etag, 'Idempotency-Key': expect.any(String) } });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('shows the retry-wait processing stage', async () => {
    mockDocument({ ...doc, status: 'PROCESSING', latestVersion: { ...latest, status: 'PROCESSING', stage: 'RETRY_WAIT' } });
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    expect(await screen.findByText('处理阶段：等待重试')).toBeInTheDocument();
  });

  it('preserves searchable legacy previews with null version IDs and unknown chunk totals', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => path.includes('/preview') ? {
      documentId: 'doc', versionId: null, documentName: '制度.txt', previewKind: 'PROCESSED_CHUNKS', items: [{ chunkId: 'c', text: '兼容旧文档正文' }], page: 1, pageSize: 20, total: 1,
    } : [{ ...doc, searchable: true, activeVersionId: null, activeVersion: null, latestVersion: { ...latest, totalChunks: null } }]);
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '预览 制度.txt' }));
    expect(await screen.findByText('兼容旧文档正文')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/knowledge-bases/kb/documents/doc/preview?page=1&pageSize=20');
    expect(screen.queryByText(/已处理 2/)).not.toBeInTheDocument();
  });

  it('honors per-document and library permissions', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => path.endsWith('/versions') ? [latest] : [{ ...doc, permissions: { canDelete: false, canReprocess: false } }]);
    view(<DocumentsPanel knowledgeBase={{ ...kb, permissions: { ...kb.permissions, canUpload: false } }} limits={limits} />);
    expect(await screen.findByRole('button', { name: '查看版本 制度.txt' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '重试 制度.txt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除 制度.txt' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看版本 制度.txt' }));
    expect(await screen.findByText('v2 · 制度.txt · 最新版本')).toBeInTheDocument();
    expect(screen.queryByLabelText('选择新版文件')).not.toBeInTheDocument();
  });

  it('uploads a version with an opaque ETag and stable idempotency headers, and handles unchanged content', async () => {
    vi.mocked(uploadForm).mockRejectedValueOnce(new TypeError('网络中断')).mockResolvedValueOnce({ ...doc, unchanged: true });
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '上传新版或查看版本 制度.txt' }));
    expect(await screen.findByText('v2 · 制度.txt · 最新版本')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('选择新版文件'), { target: { files: [new File(['new'], '新版.txt')] } });
    fireEvent.click(screen.getByRole('button', { name: '确认上传新版' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    fireEvent.click(screen.getByRole('button', { name: '确认上传新版' }));
    expect(await screen.findByText('文件内容未变化，未创建新版本。')).toBeInTheDocument();
    const [first, second] = vi.mocked(uploadForm).mock.calls;
    expect(first[0]).toBe('/knowledge-bases/kb/documents/doc/versions');
    expect((first[1].get('file') as File).name).toBe('新版.txt');
    expect(first[2]).toEqual({ headers: { 'If-Match': etag, 'Idempotency-Key': expect.any(String) } });
    expect(second[2]).toEqual(first[2]);
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.endsWith('/doc'))).toHaveLength(1);
    expect(screen.queryByText(/新版本已上传/)).not.toBeInTheDocument();
  });

  it('validates replacement files before sending', async () => {
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '上传新版或查看版本 制度.txt' }));
    expect(await screen.findByText('v2 · 制度.txt · 最新版本')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('选择新版文件'), { target: { files: [new File(['x'], '新版.pdf')] } });
    expect(screen.getByText('文件格式不支持')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认上传新版' })).toBeDisabled();
    expect(uploadForm).not.toHaveBeenCalled();
  });

  it.each([403, 404])('removes replacement controls when version access returns %i', async (status) => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path.endsWith('/versions')) throw new ApiError(status, 'access lost');
      return [doc];
    });
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '上传新版或查看版本 制度.txt' }));
    expect(await screen.findByText(status === 403 ? '没有知识库管理权限，或企业成员身份已失效。' : '资源不存在或当前账号无权访问。')).toBeInTheDocument();
    expect(screen.queryByLabelText('选择新版文件')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认上传新版' })).not.toBeInTheDocument();
  });

  it.each([403, 404])('closes stale version views and upload controls after the document list returns %i', async (status) => {
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '上传新版或查看版本 制度.txt' }));
    expect(await screen.findByText('v2 · 制度.txt · 最新版本')).toBeInTheDocument();
    vi.mocked(api.get).mockRejectedValue(new ApiError(status, 'access lost'));
    await act(async () => { await clients[0].invalidateQueries({ queryKey: ['documents', 'kb'] }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('选择上传文件')).not.toBeInTheDocument();
    expect(screen.queryByText('v2 · 制度.txt · 最新版本')).not.toBeInTheDocument();
  });

  it.each([7, 8])('refreshes a conflicted version upload at revision %i without automatically replacing its ETag', async (revision) => {
    vi.mocked(uploadForm).mockImplementationOnce(async () => {
      mockDocument({ ...doc, revision, etag: nextEtag });
      throw new ApiError(412, 'revision conflict');
    }).mockResolvedValueOnce(doc);
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '上传新版或查看版本 制度.txt' }));
    expect(await screen.findByText('v2 · 制度.txt · 最新版本')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('选择新版文件'), { target: { files: [new File(['new'], '新版.txt')] } });
    fireEvent.click(screen.getByRole('button', { name: '确认上传新版' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请确认后重新上传');
    expect(screen.getByText('已选择：新版.txt')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认上传新版' })).toBeEnabled());
    expect(uploadForm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.endsWith('/doc'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '确认上传新版' }));
    await waitFor(() => expect(uploadForm).toHaveBeenCalledTimes(2));
    expect(vi.mocked(uploadForm).mock.calls[1][2]).toEqual({ headers: { 'If-Match': nextEtag, 'Idempotency-Key': expect.any(String) } });
    expect(vi.mocked(uploadForm).mock.calls[1][2]).not.toEqual(vi.mocked(uploadForm).mock.calls[0][2]);
  });

  it('refreshes a conflicted reprocess operation before retrying with a new revision', async () => {
    vi.mocked(api.post).mockImplementationOnce(async () => {
      mockDocument({ ...doc, revision: 8, etag: nextEtag });
      throw new ApiError(409, 'conflict');
    }).mockResolvedValueOnce(doc);
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '重试 制度.txt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请重新确认是否重试');
    fireEvent.click(screen.getByRole('button', { name: '重试 制度.txt' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[1][2]).toEqual({ headers: { 'If-Match': nextEtag, 'Idempotency-Key': expect.any(String) } });
  });

  it('retains the initial upload key when a failed queue item is replayed', async () => {
    vi.mocked(uploadForm).mockRejectedValueOnce(new TypeError('网络中断')).mockResolvedValueOnce(doc);
    view(<DocumentUploader knowledgeBaseId="kb" limits={limits} />);
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [new File(['x'], '制度.txt')] } });
    fireEvent.click(screen.getByRole('button', { name: '开始上传' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    fireEvent.click(screen.getByRole('button', { name: '重新排队' }));
    fireEvent.click(screen.getByRole('button', { name: '开始上传' }));
    expect(await screen.findByText('已上传，等待后台处理')).toBeInTheDocument();
    expect(vi.mocked(uploadForm).mock.calls[1][2]).toEqual(vi.mocked(uploadForm).mock.calls[0][2]);
  });

  it('retains retry and delete keys after uncertain network failures', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError('网络中断')).mockResolvedValue(doc);
    vi.mocked(api.delete).mockRejectedValueOnce(new TypeError('删除网络中断')).mockResolvedValue(undefined);
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '重试 制度.txt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    fireEvent.click(screen.getByRole('button', { name: '重试 制度.txt' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[1]).toEqual(vi.mocked(api.post).mock.calls[0]);
    expect(vi.mocked(api.post).mock.calls[0][2]).toEqual({ headers: { 'If-Match': etag, 'Idempotency-Key': expect.any(String) } });
    fireEvent.click(screen.getByRole('button', { name: '删除 制度.txt' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除网络中断');
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.delete).mock.calls[1]).toEqual(vi.mocked(api.delete).mock.calls[0]);
    expect(vi.mocked(api.delete).mock.calls[0][1]).toEqual({ headers: { 'If-Match': etag, 'Idempotency-Key': expect.any(String) } });
  });

  it('refreshes on revision conflict and requires a new delete confirmation', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new ApiError(412, 'revision conflict'));
    view(<DocumentsPanel knowledgeBase={kb} limits={limits} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除 制度.txt' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请重新确认删除');
    expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.endsWith('/documents')).length).toBeGreaterThan(1);
  });

  it('pins default previews to the returned version and never mixes pages after a switch', async () => {
    const close = vi.fn();
    view(<DocumentPreview knowledgeBaseId="kb" documentId="doc" onClose={close} />);
    expect(await screen.findByText('旧生效版本正文')).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/knowledge-bases/kb/documents/doc/preview?page=1&pageSize=20&versionId=v1'));
    vi.mocked(api.get).mockRejectedValue(new ApiError(409, 'active changed'));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('生效版本已变更');
    expect(screen.queryByText('旧生效版本正文')).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.at(-1)?.[0]).toContain('versionId=v1');
    fireEvent.click(screen.getByRole('button', { name: '刷新文档列表' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps operation headers identical during TanStack mutation network retries', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(doc);
    vi.mocked(api.delete).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(undefined);
    vi.mocked(uploadForm).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(doc);
    const { result } = renderHook(() => ({ retry: useReprocessDocument('kb'), remove: useDeleteDocument('kb'), upload: useUploadDocumentVersion('kb') }), { wrapper: wrapper(true) });
    await act(async () => { await result.current.retry.mutateAsync(documentOperation(doc)); });
    await act(async () => { await result.current.remove.mutateAsync(documentOperation(doc)); });
    await act(async () => { await result.current.upload.mutateAsync({ ...documentOperation(doc), file: new File(['new'], 'new.txt') }); });
    expect(vi.mocked(api.post).mock.calls[1]).toEqual(vi.mocked(api.post).mock.calls[0]);
    expect(vi.mocked(api.delete).mock.calls[1]).toEqual(vi.mocked(api.delete).mock.calls[0]);
    expect(vi.mocked(uploadForm).mock.calls[1][2]).toEqual(vi.mocked(uploadForm).mock.calls[0][2]);
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path.endsWith('/doc'))).toHaveLength(3);
    expect(api.get).toHaveBeenCalledWith('/knowledge-bases/kb/documents/doc', { cache: 'no-store' });
  });

  it.each(['retry', 'remove', 'upload'] as const)('rejects stale UI revisions before sending a %s mutation', async (kind) => {
    mockDocument({ ...doc, revision: 8, etag: nextEtag });
    const { result } = renderHook(() => ({ retry: useReprocessDocument('kb'), remove: useDeleteDocument('kb'), upload: useUploadDocumentVersion('kb') }), { wrapper: wrapper() });
    const operation = { ...documentOperation(doc), file: new File(['new'], 'new.txt') };
    await act(async () => { await expect(result.current[kind].mutateAsync(operation)).rejects.toMatchObject({ status: 412 }); });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(uploadForm).not.toHaveBeenCalled();
  });

  it.each(['retry', 'remove', 'upload'] as const)('rejects a changed representation at the same revision before a %s mutation', async (kind) => {
    mockDocument({ ...doc, etag: nextEtag });
    const { result } = renderHook(() => ({ retry: useReprocessDocument('kb'), remove: useDeleteDocument('kb'), upload: useUploadDocumentVersion('kb') }), { wrapper: wrapper() });
    const operation = { ...documentOperation(doc), file: new File(['new'], 'new.txt') };
    await act(async () => { await expect(result.current[kind].mutateAsync(operation)).rejects.toMatchObject({ status: 412 }); });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(uploadForm).not.toHaveBeenCalled();
  });

  it('accepts an explicitly supplied opaque ETag without deriving one from revision', async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteDocument('kb'), { wrapper: wrapper() });
    await act(async () => { await result.current.mutateAsync({ ...documentOperation(doc), etag }); });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.delete).toHaveBeenCalledWith('/knowledge-bases/kb/documents/doc', { headers: { 'If-Match': etag, 'Idempotency-Key': expect.any(String) } });
  });
});
