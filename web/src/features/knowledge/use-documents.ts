import { useKnowledgeCacheScope, knowledgeQueryOptions } from './knowledge-cache';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, uploadForm } from '@/lib/api-client';
import type { KnowledgeDocument, KnowledgeDocumentPreview, KnowledgeDocumentVersionDetail } from '@/lib/types';

/** 在用户发起操作时创建，网络重放与同一次操作重试必须复用。 */
export interface DocumentOperation {
  documentId: string;
  revision: number;
  idempotencyKey: string;
  expectedEtag?: string;
  etag?: string;
}

export function documentOperation(document: Pick<KnowledgeDocument, 'id' | 'revision' | 'etag'>): DocumentOperation {
  return { documentId: document.id, revision: document.revision, expectedEtag: document.etag, idempotencyKey: crypto.randomUUID() };
}

export async function documentHeaders(knowledgeBaseId: string, operation: DocumentOperation) {
  if (!operation.etag) {
    const document = await api.get<KnowledgeDocument>(`/knowledge-bases/${knowledgeBaseId}/documents/${operation.documentId}`, { cache: 'no-store' });
    if (document.revision !== operation.revision || !document.etag || (operation.expectedEtag && document.etag !== operation.expectedEtag)) {
      throw new ApiError(412, '文档已更新，请刷新后重试');
    }
    // 网络结果不确定时必须保留首次快照，不能用新 ETag 改写同一次操作。
    operation.etag = document.etag;
  }
  return { 'If-Match': operation.etag, 'Idempotency-Key': operation.idempotencyKey };
}

export function hasDocumentTasks(documents?: { status: string }[]) {
  return documents?.some((doc) => doc.status === 'PENDING' || doc.status === 'PROCESSING') ?? false;
}

export function isDocumentAccessError(error: unknown) {
  return !!error && error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
}

export function documentPollingInterval(documents: { status: string }[] | undefined, error: unknown) {
  return !isDocumentAccessError(error) && hasDocumentTasks(documents) ? 3000 : false;
}

export function useDocuments(knowledgeBaseId: string | null, enabled = true) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgeDocument[]>({
    queryKey: ['documents', knowledgeBaseId, scope],
    queryFn: () => api.get(`/knowledge-bases/${knowledgeBaseId}/documents`),
    enabled: !!knowledgeBaseId && enabled,
    ...knowledgeQueryOptions,
    refetchInterval: (query) => documentPollingInterval(query.state.data, query.state.error),
  });
}

export function useDocumentVersions(knowledgeBaseId: string, documentId: string | null) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgeDocumentVersionDetail[]>({
    queryKey: ['knowledge-document-versions', knowledgeBaseId, documentId, scope],
    queryFn: () => api.get(`/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions`),
    enabled: !!documentId,
    ...knowledgeQueryOptions,
    refetchInterval: (query) => documentPollingInterval(query.state.data, query.state.error),
  });
}

export function useDocumentPreview(knowledgeBaseId: string, documentId: string | null, page = 1, versionId?: string | null) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgeDocumentPreview>({
    queryKey: ['knowledge-preview', knowledgeBaseId, documentId, versionId ?? null, page, scope],
    queryFn: () => api.get(`/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/preview?page=${page}&pageSize=20${versionId ? `&versionId=${encodeURIComponent(versionId)}` : ''}`),
    enabled: !!documentId,
    ...knowledgeQueryOptions,
  });
}

/** 接受任务、冲突和切版后刷新所有版本视图；禁止复用旧预览。 */
export function useRefreshDocuments(knowledgeBaseId: string) {
  const qc = useQueryClient();
  return () => {
    for (const prefix of ['documents', 'knowledge-document-status', 'knowledge-document-versions', 'knowledge-preview']) {
      void qc.invalidateQueries({ queryKey: [prefix, knowledgeBaseId] });
    }
    void qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
  };
}

export function useUploadDocument(knowledgeBaseId: string) {
  const refresh = useRefreshDocuments(knowledgeBaseId);
  return useMutation({
    mutationFn: ({ file, idempotencyKey }: { file: File; idempotencyKey: string }) => {
      const form = new FormData();
      form.append('file', file);
      return uploadForm<KnowledgeDocument>(`/knowledge-bases/${knowledgeBaseId}/documents/upload`, form, { headers: { 'Idempotency-Key': idempotencyKey } });
    },
    onSuccess: refresh,
  });
}

export function useUploadDocumentVersion(knowledgeBaseId: string) {
  const refresh = useRefreshDocuments(knowledgeBaseId);
  return useMutation({
    mutationFn: async (operation: DocumentOperation & { file: File }) => {
      const headers = await documentHeaders(knowledgeBaseId, operation);
      const form = new FormData();
      form.append('file', operation.file);
      return uploadForm<KnowledgeDocument & { unchanged?: boolean }>(`/knowledge-bases/${knowledgeBaseId}/documents/${operation.documentId}/versions`, form, { headers });
    },
    onSuccess: refresh,
    onError: (error) => { if (error instanceof ApiError && (error.status === 409 || error.status === 412)) refresh(); },
  });
}

export function useDeleteDocument(knowledgeBaseId: string) {
  const refresh = useRefreshDocuments(knowledgeBaseId);
  return useMutation({
    mutationFn: async (operation: DocumentOperation) => api.delete(`/knowledge-bases/${knowledgeBaseId}/documents/${operation.documentId}`, { headers: await documentHeaders(knowledgeBaseId, operation) }),
    onSuccess: refresh,
    onError: (error) => { if (error instanceof ApiError && (error.status === 409 || error.status === 412)) refresh(); },
  });
}
