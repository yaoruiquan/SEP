'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit, FileText, Search, Settings, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CenteredSpinner, ErrorState } from '@/components/ui/feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useKnowledgeBase, useKnowledgeBases, useDeleteKnowledgeBase } from '@/features/knowledge/use-knowledge-bases';
import { KnowledgeDialog } from '@/features/knowledge/knowledge-dialog';
import { KnowledgeGrantsPanel } from '@/features/knowledge/knowledge-grants-panel';
import { DocumentsPanel } from '@/features/knowledge/documents-panel';
import { KnowledgeSearchPanel } from '@/features/knowledge/knowledge-search-panel';
import { KnowledgeAdminOnly, KnowledgeError, knowledgeError } from '@/features/knowledge/knowledge-ui';

export default function KnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <KnowledgeAdminOnly><KnowledgeDetail id={id} /></KnowledgeAdminOnly>;
}

function KnowledgeDetail({ id }: { id: string }) {
  const router = useRouter();
  const context = useKnowledgeBases({ pageSize: 1 });
  const admin = context.data?.viewer.role === 'ADMIN';
  const detail = useKnowledgeBase(id, admin);
  const remove = useDeleteKnowledgeBase();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setError(null);
    try { await remove.mutateAsync(id); router.push('/knowledge'); } catch (cause) { setError(knowledgeError(cause)); }
  }

  if (context.isError) return <KnowledgeError error={context.error} retry={() => { void context.refetch(); }} />;
  if (!context.data) return <CenteredSpinner label="确认知识库管理权限…" />;
  if (!admin) return <ErrorState title="仅企业管理员可管理知识库" message="请在客户端使用已获授权的知识库。" />;
  if (detail.isError) return <KnowledgeError error={detail.error} retry={() => { void detail.refetch(); }} />;
  if (!detail.data) return <CenteredSpinner label="加载知识库…" />;
  const kb = detail.data;
  if (!kb.permissions.canManage) return <ErrorState title="没有此知识库的管理权限" message="请联系企业管理员确认权限。" />;

  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5 p-4 md:p-6">
    <Link href="/knowledge" className="inline-flex items-center gap-1 text-sm text-gtext-muted hover:text-primary"><ArrowLeft className="h-4 w-4" />返回知识库</Link>
    <header className="min-w-0"><h1 className="break-all text-2xl font-semibold">{kb.name}</h1><p className="mt-2 whitespace-pre-wrap break-words text-sm text-gtext-muted">{kb.description || '暂无说明'}</p><p className="mt-2 text-xs text-gtext-muted">{kb.documentCount} 份文档 · {kb.readyDocumentCount} 份已就绪</p></header>
    <Tabs defaultValue="documents" className="min-w-0"><TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:w-auto"><TabsTrigger value="documents"><FileText className="mr-2 h-4 w-4" />文档</TabsTrigger>
      {kb.permissions.canManageGrants && <TabsTrigger value="grants"><Users className="mr-2 h-4 w-4" />成员权限</TabsTrigger>}
      {kb.permissions.canSearch && <TabsTrigger value="search"><Search className="mr-2 h-4 w-4" />检索验证</TabsTrigger>}
      <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4" />基本设置</TabsTrigger>
    </TabsList>
      <TabsContent value="documents" className="mt-5 min-w-0"><DocumentsPanel knowledgeBase={kb} limits={context.data.limits} /></TabsContent>
      {kb.permissions.canManageGrants && <TabsContent value="grants" className="mt-5 min-w-0"><KnowledgeGrantsPanel knowledgeBaseId={id} canListCandidates={context.data.capabilities.canListGrantCandidates} /></TabsContent>}
      {kb.permissions.canSearch && <TabsContent value="search" className="mt-5 min-w-0"><KnowledgeSearchPanel knowledgeBaseId={id} maxQueryCharacters={context.data.limits.maxQueryCharacters} /></TabsContent>}
      <TabsContent value="settings" className="mt-5 space-y-6"><section className="rounded-lg border border-glassline p-4"><h2 className="font-medium">基本信息</h2><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-gtext-muted">名称</dt><dd className="mt-1 break-all">{kb.name}</dd></div><div><dt className="text-gtext-muted">说明</dt><dd className="mt-1 whitespace-pre-wrap break-words">{kb.description || '暂无说明'}</dd></div></dl><Button variant="outline" className="mt-4" onClick={() => setEditing(true)}><Edit className="mr-2 h-4 w-4" />编辑基本信息</Button></section>
        <section className="rounded-lg border border-danger/30 p-4"><h2 className="font-medium">删除知识库</h2><p className="mt-2 text-sm text-gtext-muted">删除后，其中的文档和成员授权将同时移除。</p><Button variant="danger" className="mt-4" onClick={() => { setDeleting(true); setError(null); }}><Trash2 className="mr-2 h-4 w-4" />删除知识库</Button></section>
      </TabsContent>
    </Tabs>
    <KnowledgeDialog open={editing} knowledgeBase={kb} onClose={() => setEditing(false)} />
    <Dialog open={deleting} onOpenChange={(open) => !remove.isPending && setDeleting(open)}><DialogContent><DialogHeader><DialogTitle>删除知识库</DialogTitle><DialogDescription className="break-all">确定删除「{kb.name}」及其文档和授权？此操作无法撤销。</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-danger">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(false)}>取消</Button><Button variant="danger" disabled={remove.isPending} onClick={confirmDelete}>{remove.isPending ? '删除中…' : '确认删除'}</Button></div></DialogContent></Dialog>
  </div>;
}
