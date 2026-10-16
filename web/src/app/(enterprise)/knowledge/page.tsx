'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, Edit, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, ErrorState } from '@/components/ui/feedback';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useKnowledgeBases, useDeleteKnowledgeBase } from '@/features/knowledge/use-knowledge-bases';
import { KnowledgeDialog } from '@/features/knowledge/knowledge-dialog';
import { KnowledgeAdminOnly, KnowledgeError, KnowledgeIconButton, KnowledgePagination, knowledgeError } from '@/features/knowledge/knowledge-ui';
import type { KnowledgeBase } from '@/lib/types';

export default function KnowledgePage() {
  return <KnowledgeAdminOnly><KnowledgeList /></KnowledgeAdminOnly>;
}

function KnowledgeList() {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bases = useKnowledgeBases({ keyword, page });
  const remove = useDeleteKnowledgeBase();

  async function confirmDelete() {
    if (!deleting) return;
    setError(null);
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
      if (bases.data?.items.length === 1 && page > 1) setPage(page - 1);
    } catch (cause) { setError(knowledgeError(cause)); }
  }

  if (bases.isError) return <KnowledgeError error={bases.error} retry={() => { void bases.refetch(); }} />;
  if (!bases.data) return <CenteredSpinner label="加载知识库…" />;
  if (bases.data.viewer.role !== 'ADMIN') return <ErrorState title="仅企业管理员可管理知识库" message="请在客户端使用已获授权的知识库。" />;

  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5 p-4 md:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-semibold"><BookOpen className="h-6 w-6 text-primary" />企业知识库</h1><p className="mt-1 text-sm text-gtext-muted">统一管理企业资料和成员权限，网页与客户端共享同一份知识。</p></div>
      {bases.data.capabilities.canCreateKnowledgeBase && <Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />新建知识库</Button>}
    </header>
    <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted" /><Input aria-label="搜索知识库" placeholder="搜索知识库名称或说明" maxLength={100} value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} className="pl-9" /></div>
    <div className="min-w-0 rounded-lg border border-glassline"><Table className="min-w-[720px] table-fixed"><TableHeader><TableRow><TableHead className="w-[45%]">知识库</TableHead><TableHead className="w-24">文档</TableHead><TableHead className="w-24">已就绪</TableHead><TableHead className="w-32">更新时间</TableHead><TableHead className="w-24 text-right">操作</TableHead></TableRow></TableHeader><TableBody>
      {bases.data.items.map((kb) => <TableRow key={kb.id}><TableCell><Link href={`/knowledge/${kb.id}`} className="break-all font-medium text-primary hover:underline">{kb.name}</Link><p className="mt-1 line-clamp-2 break-words text-xs text-gtext-muted">{kb.description || '暂无说明'}</p></TableCell><TableCell>{kb.documentCount}</TableCell><TableCell>{kb.readyDocumentCount}</TableCell><TableCell className="text-xs text-gtext-muted">{new Date(kb.updatedAt).toLocaleDateString('zh-CN')}</TableCell><TableCell><div className="flex justify-end gap-1">
        {kb.permissions.canManage && <><KnowledgeIconButton label={`编辑 ${kb.name}`} icon={Edit} onClick={() => { setEditing(kb); setDialogOpen(true); }} /><KnowledgeIconButton label={`删除 ${kb.name}`} icon={Trash2} danger onClick={() => { setDeleting(kb); setError(null); }} /></>}
      </div></TableCell></TableRow>)}
      {!bases.data.items.length && <TableRow><TableCell colSpan={5} className="py-14 text-center text-gtext-muted">{keyword ? '没有匹配的知识库，请更换关键词。' : '暂无知识库，创建后即可上传企业资料。'}</TableCell></TableRow>}
    </TableBody></Table></div>
    <KnowledgePagination {...bases.data} onPage={setPage} disabled={bases.isFetching} />
    <KnowledgeDialog open={dialogOpen} knowledgeBase={editing} onClose={() => { setDialogOpen(false); setEditing(null); }} />
    <Dialog open={!!deleting} onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}><DialogContent><DialogHeader><DialogTitle>删除知识库</DialogTitle><DialogDescription className="break-all">确定删除「{deleting?.name}」及其中的文档和成员授权？此操作无法撤销。</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" disabled={remove.isPending} onClick={confirmDelete}>{remove.isPending ? '删除中…' : '确认删除'}</Button></div>
    </DialogContent></Dialog>
  </div>;
}
