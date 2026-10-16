import { useKnowledgeCacheScope, knowledgeQueryOptions } from './knowledge-cache';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadForm } from '@/lib/api-client';
import type { KnowledgeDocument, KnowledgeDocumentPreview } from '@/lib/types';

export function hasDocumentTasks(documents?: { status: string }[]) {
  return documents?.some((doc) => doc.status === 'PENDING' || doc.status === 'PROCESSING') ?? false;
}

export function useDocuments(knowledgeBaseId: string | null, enabled = true) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgeDocument[]>({
    queryKey: ['documents', knowledgeBaseId, scope],
    queryFn: () => api.get(`/knowledge-bases/${knowledgeBaseId}/documents`),
    enabled: !!knowledgeBaseId && enabled,
    ...knowledgeQueryOptions,
    refetchInterval: (query) => query.state.error ? false : hasDocumentTasks(query.state.data) ? 3000 : false,
  });
}

export function useDocumentPreview(knowledgeBaseId: string, documentId: string | null, page = 1) {
  const scope = useKnowledgeCacheScope();
  return useQuery<KnowledgeDocumentPreview>({
    queryKey: ['knowledge-preview', knowledgeBaseId, documentId, page, scope],
    queryFn: () => api.get(`/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/preview?page=${page}&pageSize=20`),
    enabled: !!documentId,
    ...knowledgeQueryOptions,
  });
}

export function useUploadDocument(knowledgeBaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return uploadForm<KnowledgeDocument>(`/knowledge-bases/${knowledgeBaseId}/documents/upload`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents', knowledgeBaseId] });
      qc.invalidateQueries({ queryKey: ['knowledge-document-status', knowledgeBaseId] });
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
    },
  });
}

export function useDeleteDocument(knowledgeBaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.delete(`/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents', knowledgeBaseId] });
      qc.invalidateQueries({ queryKey: ['knowledge-document-status', knowledgeBaseId] });
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
      qc.removeQueries({ queryKey: ['knowledge-preview', knowledgeBaseId] });
    },
  });
}
