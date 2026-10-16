'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { CenteredSpinner } from '@/components/ui/feedback';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { KnowledgeMemberGrant } from '@/lib/types';
import { useKnowledgeGrants, useCreateGrant, useDeleteGrant, useGrantableMembers } from './use-knowledge-grants';
import { KnowledgeError, KnowledgeIconButton, KnowledgePagination, knowledgeError } from './knowledge-ui';

export function KnowledgeGrantsPanel({ knowledgeBaseId, canListCandidates = true }: { knowledgeBaseId: string; canListCandidates?: boolean }) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<KnowledgeMemberGrant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grants = useKnowledgeGrants(knowledgeBaseId, { keyword, page });
  const remove = useDeleteGrant(knowledgeBaseId);

  async function revoke() {
    if (!deleting) return;
    setError(null);
    try {
      await remove.mutateAsync(deleting.member.memberId);
      setDeleting(null);
      if (grants.data?.items.length === 1 && page > 1) setPage((current) => current - 1);
    } catch (cause) { setError(knowledgeError(cause)); }
  }

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">成员权限</h2><p className="mt-1 text-sm text-gtext-muted">授权给真实企业成员。企业管理员默认具有管理权，无需重复授权。</p></div>
      {canListCandidates && <Button onClick={() => setAddOpen(true)}><Plus className="mr-2 h-4 w-4" />添加成员</Button>}
    </div>
    <Input aria-label="搜索已授权成员" placeholder="按姓名或岗位搜索已授权成员" maxLength={100} value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} className="max-w-md" />
    {grants.isError ? <KnowledgeError error={grants.error} retry={() => { void grants.refetch(); }} /> : !grants.data ? <CenteredSpinner label="加载成员权限…" /> : <>
      <div className="min-w-0 rounded-lg border border-glassline"><Table className="min-w-[620px] table-fixed"><TableHeader><TableRow><TableHead className="w-[35%]">成员</TableHead><TableHead>部门 / 岗位</TableHead><TableHead>授权信息</TableHead><TableHead className="w-20 text-right">操作</TableHead></TableRow></TableHeader><TableBody>
        {grants.data.items.map((grant) => <TableRow key={grant.id}><TableCell><div className="flex items-center gap-2"><Avatar name={grant.member.name} src={grant.member.avatarUrl ?? undefined} className="h-8 w-8 shrink-0" /><span className="break-words">{grant.member.name}</span></div></TableCell>
          <TableCell className="break-words text-gtext-muted">{[grant.member.departmentName, grant.member.position].filter(Boolean).join(' / ') || '未设置'}</TableCell>
          <TableCell className="text-xs text-gtext-muted"><p className="break-words">{grant.grantedBy.name}</p><p>{new Date(grant.grantedAt).toLocaleDateString('zh-CN')}</p></TableCell>
          <TableCell className="text-right"><KnowledgeIconButton label={`撤销 ${grant.member.name} 的权限`} icon={Trash2} danger onClick={() => { setDeleting(grant); setError(null); }} /></TableCell>
        </TableRow>)}
        {!grants.data.items.length && <TableRow><TableCell colSpan={4} className="py-12 text-center text-gtext-muted">{keyword ? '没有匹配的授权成员。' : '尚未添加成员授权。'}</TableCell></TableRow>}
      </TableBody></Table></div><KnowledgePagination {...grants.data} onPage={setPage} disabled={grants.isFetching} />
    </>}
    {addOpen && <AddMembers knowledgeBaseId={knowledgeBaseId} onClose={() => setAddOpen(false)} />}
    <Dialog open={!!deleting} onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}><DialogContent><DialogHeader><DialogTitle>撤销成员权限</DialogTitle><DialogDescription>确定撤销「{deleting?.member.name}」对此知识库的访问权？</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" disabled={remove.isPending} onClick={revoke}>{remove.isPending ? '撤销中…' : '确认撤销'}</Button></div>
    </DialogContent></Dialog>
  </div>;
}

function AddMembers({ knowledgeBaseId, onClose }: { knowledgeBaseId: string; onClose: () => void }) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const members = useGrantableMembers({ keyword, page });
  const create = useCreateGrant(knowledgeBaseId);

  async function submit() {
    if (!selected.size || create.isPending) return;
    setError(null);
    try { await create.mutateAsync({ memberIds: [...selected] }); onClose(); } catch (cause) { setError(knowledgeError(cause)); }
  }

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  return <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}><DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle>添加企业成员</DialogTitle><DialogDescription>选择成员后批量授权，跨页选择会保留。已授权成员重复提交不会重复创建。</DialogDescription></DialogHeader>
    <Input aria-label="搜索企业成员" placeholder="搜索姓名或岗位" maxLength={100} value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {members.isError ? <KnowledgeError error={members.error} retry={() => { void members.refetch(); }} /> : !members.data ? <CenteredSpinner label="加载企业成员…" /> : <>
      <ul className="max-h-72 divide-y divide-glassline overflow-y-auto">{members.data.items.map((member) => <li key={member.memberId}><label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-3 hover:bg-muted">
        <input type="checkbox" aria-label={`选择 ${member.name}`} checked={selected.has(member.memberId)} onChange={() => toggle(member.memberId)} disabled={create.isPending || (!selected.has(member.memberId) && selected.size >= 100)} className="h-4 w-4 shrink-0 accent-primary" />
        <Avatar name={member.name} src={member.avatarUrl ?? undefined} className="h-8 w-8 shrink-0" /><div className="min-w-0"><p className="break-words text-sm font-medium">{member.name}</p><p className="break-words text-xs text-gtext-muted">{[member.departmentName, member.position].filter(Boolean).join(' / ') || '未设置部门及岗位'}</p></div>
      </label></li>)}</ul>
      {!members.data.items.length && <p className="py-8 text-center text-sm text-gtext-muted">没有匹配的企业成员。</p>}
      <KnowledgePagination {...members.data} onPage={setPage} disabled={members.isFetching || create.isPending} />
    </>}
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-gtext-muted">已选 {selected.size} 人，最多 100 人</span><div className="flex gap-2"><Button variant="outline" onClick={onClose} disabled={create.isPending}>取消</Button><Button onClick={submit} disabled={!selected.size || create.isPending || members.isError}>{create.isPending ? '授权中…' : '确认授权'}</Button></div></div>
  </DialogContent></Dialog>;
}
