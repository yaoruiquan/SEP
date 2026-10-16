'use client';

import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KnowledgeLimits } from '@/lib/types';
import { useUploadDocument } from './use-documents';
import { KnowledgeIconButton, knowledgeError } from './knowledge-ui';

interface UploadItem { id: string; file: File; status: 'pending' | 'uploading' | 'success' | 'error'; error?: string }

export function validateKnowledgeFile(file: File, limits: KnowledgeLimits) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!limits.allowedExtensions.some((allowed) => allowed.replace(/^\./, '').toLowerCase() === extension)) return '文件格式不支持';
  if (!file.size) return '不能上传空文件';
  if (file.size > limits.maxFileBytes) return `文件超过大小限制（${formatKnowledgeBytes(limits.maxFileBytes)}）`;
  return null;
}

export function formatKnowledgeBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function DocumentUploader({ knowledgeBaseId, limits, onUploadComplete }: {
  knowledgeBaseId: string; limits: KnowledgeLimits; onUploadComplete?: () => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const upload = useUploadDocument(knowledgeBaseId);

  function addFiles(files: File[]) {
    if (active.current) return;
    setError(null);
    const queued = items.filter((item) => item.status !== 'success').length;
    if (files.length + queued > limits.maxFilesPerRequest) {
      setError(`每批最多选择 ${limits.maxFilesPerRequest} 个文件，请分批上传。`);
      return;
    }
    setItems((current) => [...current.filter((item) => item.status !== 'success'), ...files.map((file) => {
      const validation = validateKnowledgeFile(file, limits);
      return { id: crypto.randomUUID(), file, status: validation ? 'error' as const : 'pending' as const, error: validation ?? undefined };
    })]);
  }

  async function startUpload() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    const pending = items.filter((item) => item.status === 'pending');
    let accepted = false;
    try {
      for (const item of pending) {
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'uploading' } : entry));
        try {
          await upload.mutateAsync(item.file);
          accepted = true;
          setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'success', error: undefined } : entry));
        } catch (cause) {
          setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'error', error: knowledgeError(cause) } : entry));
        }
      }
    } finally {
      active.current = false;
      setBusy(false);
      if (accepted) onUploadComplete?.();
    }
  }

  return <section aria-label="上传文档" className="space-y-3 rounded-lg border border-glassline p-4">
    <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }} className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 text-sm"><p className="font-medium">上传企业资料</p>
        <p className="mt-1 break-words text-xs text-gtext-muted">{limits.allowedExtensions.join('、')} · 单文件不超过 {formatKnowledgeBytes(limits.maxFileBytes)} · 每批最多 {limits.maxFilesPerRequest} 个</p>
      </div>
      <label className={`inline-flex shrink-0 items-center gap-2 rounded-md border border-glassline px-3 py-2 text-sm ${busy ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}>
        <Upload className="h-4 w-4" />选择文件
        <input type="file" aria-label="选择上传文件" multiple disabled={busy} className="sr-only" accept={limits.allowedExtensions.map((ext) => `.${ext.replace(/^\./, '')}`).join(',')} onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      </label>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {items.length > 0 && <ul className="divide-y divide-glassline">{items.map((item) => <li key={item.id} className="flex items-start gap-2 py-2 text-sm">
      <div className="min-w-0 flex-1"><p className="break-all">{item.file.name}</p>
        <p className={`text-xs ${item.status === 'error' ? 'text-danger' : 'text-gtext-muted'}`} role={item.status === 'error' ? 'alert' : undefined}>
          {item.status === 'uploading' ? '正在上传…' : item.status === 'success' ? '已上传，等待后台处理' : item.error ?? '待上传'}
        </p>
      </div>
      {item.status === 'error' && !validateKnowledgeFile(item.file, limits) && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'pending', error: undefined } : entry))}>重新排队</Button>}
      <KnowledgeIconButton label={`移除 ${item.file.name}`} icon={X} disabled={busy} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} />
    </li>)}</ul>}
    {items.some((item) => item.status === 'pending' || item.status === 'uploading') && <div className="flex justify-end"><Button disabled={busy} onClick={startUpload}>{busy ? '上传中…' : '开始上传'}</Button></div>}
  </section>;
}
