import type { KnowledgeDocumentVersionDetail } from '@/lib/types';

const stages: Record<string, string> = {
  PENDING: '等待处理', QUEUED: '等待处理', UPLOADED: '等待处理',
  RETRY_WAIT: '等待重试',
  PARSING: '解析文档', EXTRACTING: '提取正文', CHUNKING: '切分正文',
  EMBEDDING: '生成索引', INDEXING: '生成索引', PUBLISHING: '生效中',
  READY: '处理完成', COMPLETED: '处理完成', DONE: '处理完成', FAILED: '处理失败',
};

export function DocumentVersionDetails({ version }: { version: KnowledgeDocumentVersionDetail | null }) {
  if (!version) return null;
  return <div className="mt-1 space-y-1 break-words text-xs text-gtext-muted">
    {version.stage && <p>处理阶段：{stages[version.stage] ?? '后台处理中'}</p>}
    {version.totalChunks != null && version.totalChunks > 0 && <p>已处理 {version.processedChunks} / {version.totalChunks} 个片段</p>}
    {version.status === 'FAILED' && <>
      <p className="text-danger">{version.lastError || '文档处理失败，请稍后重试或上传新版本。'}</p>
      <p>{version.retryable ? '可重试' : '请上传新版本或联系管理员'}{version.attempts > 0 ? ` · 已尝试 ${version.attempts} 次` : ''}</p>
    </>}
  </div>;
}
