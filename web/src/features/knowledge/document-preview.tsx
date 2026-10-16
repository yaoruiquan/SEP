'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredSpinner } from '@/components/ui/feedback';
import { useDocumentPreview } from './use-documents';
import { KnowledgeError, KnowledgePagination } from './knowledge-ui';

export function DocumentPreview({ knowledgeBaseId, documentId, onClose }: { knowledgeBaseId: string; documentId: string | null; onClose: () => void }) {
  return <Dialog open={!!documentId} onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
    <DialogHeader><DialogTitle>文档只读预览</DialogTitle><DialogDescription>查看处理后的正文片段。</DialogDescription></DialogHeader>
    {documentId && <PreviewContent key={documentId} knowledgeBaseId={knowledgeBaseId} documentId={documentId} />}
  </DialogContent></Dialog>;
}

function PreviewContent({ knowledgeBaseId, documentId }: { knowledgeBaseId: string; documentId: string }) {
  const [page, setPage] = useState(1);
  const preview = useDocumentPreview(knowledgeBaseId, documentId, page);
  if (preview.isError) return <KnowledgeError error={preview.error} retry={() => { void preview.refetch(); }} />;
  if (!preview.data) return <CenteredSpinner label="加载文档预览…" />;
  return <div className="min-w-0 space-y-3"><h3 className="break-all font-medium">{preview.data.documentName}</h3>
    {preview.data.items.length ? preview.data.items.map((block) => <p key={block.chunkId} className="whitespace-pre-wrap break-words rounded-lg border border-glassline p-4 text-sm leading-7 [overflow-wrap:anywhere]">{block.text}</p>) : <p className="py-6 text-sm text-gtext-muted">暂无可预览的正文。</p>}
    <KnowledgePagination {...preview.data} onPage={setPage} disabled={preview.isFetching} />
  </div>;
}
