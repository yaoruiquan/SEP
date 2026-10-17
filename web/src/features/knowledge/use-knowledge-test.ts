import { useKnowledgeCacheScope, knowledgeQueryOptions } from './knowledge-cache';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import type { KnowledgeDocument } from '@/lib/types';
import { documentHeaders, documentPollingInterval, isDocumentAccessError, useRefreshDocuments, type DocumentOperation } from './use-documents';

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface TestSearchResult {
  chunkId: string;
  content: string;
  source: string;
  score: number;
  knowledgeBaseId: string;
  documentId?: string | null;
  documentName?: string | null;
}

export interface TestSearchResponse {
  query: string;
  topK: number;
  scoreThreshold: number;
  strategy: string;
  hitCount: number;
  durationMs: number;
  results: TestSearchResult[];
}

export interface DocumentStatusItem {
  id: string;
  originalName: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  lastError: string | null;
  processedAt: string | null;
  embeddingModel: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentStatusSummary {
  total: number;
  vectorized: number;
  pending: number;
  processing: number;
  ready: number;
  failed: number;
  documents: DocumentStatusItem[];
}

export interface AnalyticsData {
  knowledgeBaseId: string;
  period: { from: string; to: string };
  totalSearches: number;
  testSearches: number;
  realSearches: number;
  averageHitCount: number;
  averageTopScore: number | null;
  zeroHitCount: number;
  zeroHitRate: number;
  zeroHitQueries: string[];
  neverHitDocuments: { id: string; originalName: string }[];
  embeddingAvailable: boolean;
  embeddingModel: string;
  embeddingDimension: number;
  recentLogs: {
    id: string;
    query: string;
    hitCount: number;
    topScore: number | null;
    strategy: string;
    isTest: boolean;
    durationMs: number | null;
    createdAt: string;
  }[];
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** 文档处理状态（可选 3 秒轮询） */
export function useDocumentStatus(
  knowledgeBaseId: string | null,
  opts?: { refetchInterval?: number | false },
) {
  const scope = useKnowledgeCacheScope();
  return useQuery<DocumentStatusSummary>({
    queryKey: ['knowledge-document-status', knowledgeBaseId, scope],
    queryFn: () =>
      api.get<DocumentStatusSummary>(
        `/knowledge-bases/${knowledgeBaseId}/documents/status`,
      ),
    enabled: !!knowledgeBaseId,
    ...knowledgeQueryOptions,
    refetchInterval: (query) => isDocumentAccessError(query.state.error) ? false : opts?.refetchInterval ?? documentPollingInterval(query.state.data?.documents, query.state.error),
  });
}

/** 单文档重处理，复用调用方创建的操作以保证网络重放幂等。 */
export function useReprocessDocument(knowledgeBaseId: string) {
  const refresh = useRefreshDocuments(knowledgeBaseId);
  return useMutation({
    mutationFn: async (operation: DocumentOperation) =>
      api.post<KnowledgeDocument>(
        `/knowledge-bases/${knowledgeBaseId}/documents/${operation.documentId}/reprocess`,
        {},
        { headers: await documentHeaders(knowledgeBaseId, operation) },
      ),
    onSuccess: refresh,
    onError: (error) => { if (error instanceof ApiError && (error.status === 409 || error.status === 412)) refresh(); },
  });
}

/** 批量重处理 */
export function useBatchReprocess(knowledgeBaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { documentIds?: string[]; statuses?: string[] }) =>
      api.post<{ queued: number; skipped: number; documentIds: string[] }>(
        `/knowledge-bases/${knowledgeBaseId}/documents/batch-reprocess`,
        payload,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-document-status', knowledgeBaseId] });
      qc.invalidateQueries({ queryKey: ['documents', knowledgeBaseId] });
    },
  });
}

/** 检索分析数据 */
export function useKnowledgeAnalytics(knowledgeBaseId: string | null, days = 30) {
  const scope = useKnowledgeCacheScope();
  return useQuery<AnalyticsData>({
    queryKey: ['knowledge-analytics', knowledgeBaseId, days, scope],
    queryFn: () =>
      api.get<AnalyticsData>(
        `/knowledge-bases/${knowledgeBaseId}/analytics?days=${days}`,
      ),
    enabled: !!knowledgeBaseId,
    ...knowledgeQueryOptions,
  });
}

/** 检索测试（mutation，每次手动触发） */
export function useTestSearch(knowledgeBaseId: string) {
  return useMutation({
    mutationFn: (payload: {
      query: string;
      topK?: number;
      scoreThreshold?: number;
      useRerank?: boolean;
    }) =>
      api.post<TestSearchResponse>(
        `/knowledge-bases/${knowledgeBaseId}/test-search`,
        payload,
      ),
  });
}
