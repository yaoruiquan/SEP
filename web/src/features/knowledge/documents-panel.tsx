'use client';

import { useState } from 'react';
import { Eye, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CenteredSpinner } from '@/components/ui/feedback';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { KnowledgeBase, KnowledgeDocument, KnowledgeLimits, KnowledgeProcessingStatus } from '@/lib/types';
import { useDocuments, useDeleteDocument } from './use-documents';
import { useDocumentStatus, useReprocessDocument } from './use-knowledge-test';
import { DocumentUploader, formatKnowledgeBytes } from './document-uploader';
import { DocumentPreview } from './document-preview';
import { KnowledgeError, KnowledgeIconButton, KnowledgePagination, knowledgeError } from './knowledge-ui';

const statuses: Record<KnowledgeProcessingStatus, string> = { PENDING: '排队中', PROCESSING: '处理中', READY: '可用', FAILED: '处理失败' };

export function DocumentsPanel({ knowledgeBase, limits }: { knowledgeBase: KnowledgeBase; limits: KnowledgeLimits }) {
  const documents = useDocuments(knowledgeBase.id);
  const status = useDocumentStatus(knowledgeBase.id);
  const reprocess = useReprocessDocument(knowledgeBase.id);
  const remove = useDeleteDocument(knowledgeBase.id);
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const rows = documents.data?.map((doc) => ({ ...doc, ...status.data?.documents.find((item) => item.id === doc.id) })) ?? [];
  const filtered = rows.filter((doc) => filter === 'ALL' || doc.status === filter);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));

  async function retry(id: string) {
    setError(null);
    try { await reprocess.mutateAsync(id); } catch (cause) { setError(knowledgeError(cause)); }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    try { await remove.mutateAsync(deleting.id); setDeleting(null); } catch (cause) { setDeleteError(knowledgeError(cause)); }
  }

  return <div className="min-w-0 space-y-4">
    {knowledgeBase.permissions.canUpload && <DocumentUploader knowledgeBaseId={knowledgeBase.id} limits={limits} />}
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm">处理状态
      <select aria-label="文档状态" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }} className="h-9 rounded-md border border-glassline bg-background px-3">
        <option value="ALL">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label><p className="text-xs text-gtext-muted">有待处理任务时自动更新</p></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {documents.isError ? <KnowledgeError error={documents.error} retry={() => { void documents.refetch(); }} /> : status.isError ? <KnowledgeError error={status.error} retry={() => { void status.refetch(); }} /> : !documents.data || !status.data ? <CenteredSpinner label="加载文档…" /> : <>
      <div className="min-w-0 rounded-lg border border-glassline"><Table className="min-w-[680px] table-fixed"><TableHeader><TableRow>
        <TableHead className="w-[45%]">文档</TableHead><TableHead className="w-24">大小</TableHead><TableHead className="w-28">处理状态</TableHead><TableHead className="w-28">上传日期</TableHead><TableHead className="w-32 text-right">操作</TableHead>
      </TableRow></TableHeader><TableBody>
        {filtered.slice((currentPage - 1) * 20, currentPage * 20).map((doc) => <TableRow key={doc.id}>
          <TableCell><p className="break-all font-medium">{doc.originalName}</p>{doc.lastError && doc.status === 'FAILED' && <p className="mt-1 break-words text-xs text-danger">{doc.lastError}</p>}</TableCell>
          <TableCell className="text-gtext-muted">{formatKnowledgeBytes(doc.fileSize)}</TableCell>
          <TableCell><Badge variant={doc.status === 'READY' ? 'glass-success' : doc.status === 'FAILED' ? 'glass-danger' : 'glass-info'}>{statuses[doc.status]}</Badge></TableCell>
          <TableCell className="text-gtext-muted">{new Date(doc.createdAt).toLocaleDateString('zh-CN')}</TableCell>
          <TableCell><div className="flex justify-end gap-1">
            <KnowledgeIconButton label={`预览 ${doc.originalName}`} icon={Eye} disabled={doc.status !== 'READY'} onClick={() => setPreviewId(doc.id)} />
            {doc.status === 'FAILED' && knowledgeBase.permissions.canManage && doc.permissions?.canReprocess !== false && <KnowledgeIconButton label={`重试 ${doc.originalName}`} icon={RefreshCw} disabled={reprocess.isPending} onClick={() => { void retry(doc.id); }} />}
            {knowledgeBase.permissions.canManage && doc.permissions?.canDelete !== false && <KnowledgeIconButton label={`删除 ${doc.originalName}`} icon={Trash2} danger onClick={() => { setDeleting(doc); setDeleteError(null); }} />}
          </div></TableCell>
        </TableRow>)}
        {!filtered.length && <TableRow><TableCell colSpan={5} className="py-12 text-center text-gtext-muted">{filter === 'ALL' ? '暂无文档，请上传企业资料。' : '没有符合当前状态的文档。'}</TableCell></TableRow>}
      </TableBody></Table></div>
      <KnowledgePagination page={currentPage} pageSize={20} total={filtered.length} onPage={setPage} />
    </>}
    <DocumentPreview knowledgeBaseId={knowledgeBase.id} documentId={previewId} onClose={() => setPreviewId(null)} />
    <Dialog open={!!deleting} onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}><DialogContent><DialogHeader><DialogTitle>删除文档</DialogTitle><DialogDescription className="break-all">确定删除「{deleting?.originalName}」？删除后将无法继续检索此文档。</DialogDescription></DialogHeader>
      {deleteError && <p role="alert" className="text-sm text-danger">{deleteError}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" disabled={remove.isPending} onClick={confirmDelete}>{remove.isPending ? '删除中…' : '确认删除'}</Button></div>
    </DialogContent></Dialog>
  </div>;
}
