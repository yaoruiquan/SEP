'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredSpinner } from '@/components/ui/feedback';
import { ApiError } from '@/lib/api-client';
import type { KnowledgeDocument, KnowledgeLimits } from '@/lib/types';
import { documentOperation, isDocumentAccessError, useDocumentVersions, useUploadDocumentVersion, type DocumentOperation } from './use-documents';
import { validateKnowledgeFile } from './document-uploader';
import { DocumentVersionDetails } from './document-version-details';
import { KnowledgeError, knowledgeError } from './knowledge-ui';

const statuses = { PENDING: '排队中', PROCESSING: '处理中', READY: '可用', FAILED: '处理失败' };

export function DocumentVersionsDialog({ knowledgeBaseId, document, limits, canUpload, onClose }: {
  knowledgeBaseId: string; document: KnowledgeDocument | null; limits: KnowledgeLimits; canUpload: boolean; onClose: () => void;
}) {
  return <Dialog open={!!document} onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[85vh] overflow-y-auto">
    <DialogHeader><DialogTitle>文档版本</DialogTitle><DialogDescription className="break-all">{document?.originalName} · 新版本处理成功后自动生效。</DialogDescription></DialogHeader>
    {document && <VersionsContent key={document.id} knowledgeBaseId={knowledgeBaseId} document={document} limits={limits} canUpload={canUpload} />}
  </DialogContent></Dialog>;
}

function VersionsContent({ knowledgeBaseId, document, limits, canUpload }: {
  knowledgeBaseId: string; document: KnowledgeDocument; limits: KnowledgeLimits; canUpload: boolean;
}) {
  const versions = useDocumentVersions(knowledgeBaseId, document.id);
  const upload = useUploadDocumentVersion(knowledgeBaseId);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useRef<(DocumentOperation & { file: File }) | null>(null);
  const busy = useRef(false);

  async function submit() {
    if (!file || busy.current) return;
    busy.current = true;
    setError(null); setMessage(null);
    // 不确定网络结果时保留原操作，即使轮询已取得更新的文档。
    if (!operation.current) {
      operation.current = { ...documentOperation(document), file };
    }
    try {
      const result = await upload.mutateAsync(operation.current);
      setMessage(result.unchanged ? '文件内容未变化，未创建新版本。' : '新版本已上传，等待后台处理；现有生效版本可继续检索。');
      setFile(null); operation.current = null;
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 409 || cause.status === 412)) {
        operation.current = null;
        setError('文档状态或版本已更新，正在刷新列表。请确认后重新上传。');
      } else setError(knowledgeError(cause));
    } finally { busy.current = false; }
  }

  if (isDocumentAccessError(upload.error)) return <KnowledgeError error={upload.error} />;
  if (versions.isError) return <KnowledgeError error={versions.error} retry={() => { void versions.refetch(); }} />;
  if (!versions.data) return <CenteredSpinner label="加载版本…" />;

  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-gtext-muted">生效版本：{document.activeVersion ? `v${document.activeVersion.version}` : '暂无'} · 最新版本：{document.latestVersion ? `v${document.latestVersion.version}` : '暂无'}</p>
    {canUpload && <section aria-label="上传新版本" className="space-y-3 rounded-lg border border-glassline p-4">
      <label className="block text-sm font-medium">上传新版
        <input type="file" aria-label="选择新版文件" disabled={upload.isPending} accept={limits.allowedExtensions.map((ext) => `.${ext.replace(/^\./, '')}`).join(',')} className="mt-2 block w-full text-sm" onChange={(event) => {
          const selected = event.target.files?.[0] ?? null;
          const validation = selected ? validateKnowledgeFile(selected, limits) : null;
          setFile(validation ? null : selected); setError(validation); setMessage(null); operation.current = null;
          event.target.value = '';
        }} />
      </label>
      {file && <p className="break-all text-sm text-gtext-muted">已选择：{file.name}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {message && <p role="status" className="text-sm text-gtext-muted">{message}</p>}
      <Button disabled={!file || upload.isPending || versions.isFetching} onClick={submit}>{upload.isPending ? '上传中…' : '确认上传新版'}</Button>
    </section>}
    <ul className="divide-y divide-glassline">
      {versions.data.map((version) => <li key={version.id} className="py-3">
        <p className="break-all text-sm font-medium">v{version.version} · {version.originalName}{version.id === document.activeVersionId ? ' · 生效版本' : ''}{version.id === document.latestVersionId ? ' · 最新版本' : ''}</p>
        <p className="mt-1 text-xs text-gtext-muted">{new Date(version.createdAt).toLocaleString('zh-CN')}</p>
        <Badge variant={version.status === 'FAILED' ? 'glass-danger' : version.status === 'READY' ? 'glass-success' : 'glass-info'}>{statuses[version.status]}</Badge>
        <DocumentVersionDetails version={version} />
      </li>)}
      {!versions.data.length && <li className="py-6 text-sm text-gtext-muted">暂无版本记录。</li>}
    </ul>
  </div>;
}
