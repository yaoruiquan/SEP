'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Check, ChevronRight, Clock3, Eye, FileCode2, GitBranch, Search, Send, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import type { SkillVersionSummary } from '@/lib/types';
import { SkillVersionPreviewDialog } from '@/features/skill-version/SkillVersionPreviewDialog';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import { useEnterpriseSkillVersions, useReviewEnterpriseSkillVersion, useSubmitPlatformSkillReview } from '@/features/skill-version/use-skill-version';

type EnterpriseVersion = SkillVersionSummary & { capability: { id: string; name: string; description: string } };
const needsAction = (v: EnterpriseVersion) => v.status === 'DRAFT' || v.status === 'ENTERPRISE_REJECTED' || v.status === 'PENDING_ENTERPRISE_REVIEW' || (v.status === 'ENTERPRISE_APPROVED' && !v.hasPlatformSubmission);

export default function EnterpriseSkillsPage() {
  const query = useEnterpriseSkillVersions();
  const review = useReviewEnterpriseSkillVersion();
  const submitPlatform = useSubmitPlatformSkillReview();
  const isAdmin = useAuthStore((s) => s.roleInEnterprise) === 'ENTERPRISE_ADMIN';
  const [previewId, setPreviewId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [onlyAction, setOnlyAction] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, { capability: EnterpriseVersion['capability']; versions: EnterpriseVersion[] }>();
    for (const version of query.data ?? []) {
      const group = map.get(version.capabilityId);
      if (group) group.versions.push(version);
      else map.set(version.capabilityId, { capability: version.capability, versions: [version] });
    }
    return [...map.values()].map((group) => ({ ...group, versions: group.versions.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)) }))
      .sort((a, b) => Number(b.versions.some(needsAction)) - Number(a.versions.some(needsAction)) || +new Date(b.versions[0].updatedAt) - +new Date(a.versions[0].updatedAt));
  }, [query.data]);

  const visibleGroups = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return groups.filter((g) => (!keyword || g.capability.name.toLowerCase().includes(keyword) || g.capability.description.toLowerCase().includes(keyword)) && (!onlyAction || g.versions.some(needsAction)));
  }, [groups, onlyAction, search]);

  useEffect(() => {
    if (!visibleGroups.some((g) => g.capability.id === selectedId)) setSelectedId(visibleGroups[0]?.capability.id ?? '');
  }, [selectedId, visibleGroups]);

  const selected = visibleGroups.find((g) => g.capability.id === selectedId) ?? visibleGroups[0];
  const actionCount = groups.reduce((n, g) => n + g.versions.filter(needsAction).length, 0);
  const submittedCount = groups.reduce((n, g) => n + g.versions.filter((v) => v.hasPlatformSubmission).length, 0);

  const decide = (id: string, decision: 'APPROVE' | 'REJECT') => {
    const comment = decision === 'REJECT' ? window.prompt('请输入驳回原因')?.trim() : undefined;
    if (decision === 'REJECT' && !comment) return;
    review.mutate({ id, decision, comment }, {
      onSuccess: () => toast.success(decision === 'APPROVE' ? '企业审核已通过' : '版本已驳回'),
      onError: (error) => toast.error(error instanceof Error ? error.message : '审核失败'),
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><h1 className="text-2xl font-semibold text-gtext-primary">技能管理</h1><p className="mt-1 text-sm text-gtext-muted">按技能管理版本路线，处理企业审核并跟踪平台提交。</p></div>
        <div className="flex items-center gap-6 border-l border-glassline pl-5"><Metric label="技能" value={groups.length} /><Metric label="待处理" value={actionCount} accent={actionCount > 0} /><Metric label="已提交平台" value={submittedCount} /></div>
      </header>

      {query.isLoading ? <Card><CenteredSpinner label="加载技能版本..." /></Card> : groups.length ? (
        <Card className="min-h-[620px] overflow-hidden">
          <div className="grid min-h-[620px] lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="border-b border-glassline bg-glass-1 lg:border-b-0 lg:border-r">
              <div className="space-y-3 border-b border-glassline p-4">
                <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted" /><Input glass value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="搜索技能" aria-label="搜索技能" /></div>
                <div className="flex gap-1 rounded-md border border-glassline bg-glass-2 p-1"><FilterButton active={!onlyAction} onClick={() => setOnlyAction(false)}>全部 {groups.length}</FilterButton><FilterButton active={onlyAction} onClick={() => setOnlyAction(true)}>待处理 {actionCount}</FilterButton></div>
              </div>
              <div className="max-h-[510px] overflow-y-auto p-2 scroll-thin">
                {visibleGroups.length ? visibleGroups.map((group) => {
                  const active = group.capability.id === selected?.capability.id;
                  const pending = group.versions.filter(needsAction).length;
                  return <button key={group.capability.id} type="button" onClick={() => setSelectedId(group.capability.id)} className={cn('group mb-1 flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors', active ? 'border-glassline-brand bg-glass-accent-2' : 'border-transparent hover:border-glassline hover:bg-glass-2')}>
                    <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border', active ? 'border-glassline-brand bg-gbrand/15 text-gbrand-text' : 'border-glassline bg-glass-2 text-gtext-secondary')}><Sparkles className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-gtext-primary">{group.capability.name}</span><ChevronRight className={cn('h-4 w-4 shrink-0 text-gtext-muted', active && 'text-gbrand-text')} /></span><span className="mt-1 flex items-center gap-2 text-xs text-gtext-muted"><span>{group.versions.length} 个版本</span><span>最新 v{group.versions[0].version}</span>{pending > 0 && <span className="font-medium text-gwarning">{pending} 待办</span>}</span></span>
                  </button>;
                }) : <p className="px-3 py-10 text-center text-sm text-gtext-muted">没有匹配的技能</p>}
              </div>
            </aside>

            <section className="min-w-0">
              {selected ? <>
                <div className="border-b border-glassline px-5 py-5 lg:px-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-xl font-semibold text-gtext-primary">{selected.capability.name}</h2><Badge variant="glass">{selected.versions.length} 个版本</Badge></div><p className="mt-1 max-w-2xl text-sm text-gtext-secondary">{selected.capability.description || '暂无技能说明'}</p></div><div className="flex shrink-0 items-center gap-2 text-xs text-gtext-muted"><Clock3 className="h-4 w-4" />{formatDistanceToNow(new Date(selected.versions[0].updatedAt), { addSuffix: true, locale: zhCN })}更新</div></div></div>
                <div className="px-5 py-5 lg:px-7">
                  <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-gbrand-text" /><h3 className="text-sm font-semibold text-gtext-primary">版本路线</h3></div><span className="text-xs text-gtext-muted">按最近更新排序</span></div>
                  {selected.versions.map((version, index) => {
                    const status = SKILL_VERSION_STATUS[version.status];
                    const latest = index === 0;
                    return <article key={version.id} className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
                      {index < selected.versions.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-8px)] w-px bg-glassline" />}
                      <span className={cn('relative z-10 mt-1 h-6 w-6 rounded-full border-4 border-solid-raised', latest ? 'bg-gbrand shadow-[0_0_0_3px_var(--gbrand-ring)]' : 'bg-gtext-disabled')} />
                      <div className={cn('rounded-md border p-4', latest ? 'border-glassline-brand bg-glass-accent-2' : 'border-glassline bg-glass-1')}><div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-gtext-primary">v{version.version}</span>{latest && <Badge className="border border-glassline-brand bg-gbrand/15 text-gbrand-text">最新</Badge>}<Badge className={status.className}>{status.label}</Badge>{version.hasPlatformSubmission && <Badge variant="glass-info">已提交平台</Badge>}</div><p className="mt-1.5 line-clamp-2 text-sm text-gtext-secondary">{version.changeSummary || '未填写变更说明'}</p><p className="mt-2 text-xs text-gtext-muted">更新于 {new Date(version.updatedAt).toLocaleDateString('zh-CN')}</p></div><VersionActions version={version} isAdmin={isAdmin} submitting={submitPlatform.isPending} onPreview={setPreviewId} onDecide={decide} onSubmit={(id) => submitPlatform.mutate(id, { onSuccess: () => toast.success('已生成平台审核副本'), onError: (error) => toast.error(error instanceof Error ? error.message : '提交失败') })} /></div></div>
                    </article>;
                  })}
                </div>
              </> : <EmptyState title="没有匹配的技能" description="调整搜索条件或查看全部技能。" />}
            </section>
          </div>
        </Card>
      ) : <Card><EmptyState title="还没有企业技能版本" description="在硅基员工详情中选择一个技能，创建企业版本后会显示在这里。" /></Card>}
      <SkillVersionPreviewDialog versionId={previewId} open={Boolean(previewId)} onOpenChange={(open) => !open && setPreviewId('')} />
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) { return <div><p className={cn('text-lg font-semibold leading-none text-gtext-primary', accent && 'text-gwarning')}>{value}</p><p className="mt-1 text-xs text-gtext-muted">{label}</p></div>; }
function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={cn('h-7 flex-1 rounded-sm px-2 text-xs font-medium transition-colors', active ? 'bg-solid-raised text-gtext-primary shadow-sm' : 'text-gtext-muted hover:text-gtext-primary')}>{children}</button>; }

function VersionActions({ version, isAdmin, submitting, onPreview, onDecide, onSubmit }: { version: EnterpriseVersion; isAdmin: boolean; submitting: boolean; onPreview: (id: string) => void; onDecide: (id: string, decision: 'APPROVE' | 'REJECT') => void; onSubmit: (id: string) => void }) {
  return <div className="flex shrink-0 flex-wrap gap-2">
    <Button variant="glass" size="sm" onClick={() => onPreview(version.id)}><Eye className="h-4 w-4" />预览</Button>
    {(version.status === 'DRAFT' || version.status === 'ENTERPRISE_REJECTED') && <Link href={`/skills/${version.id}/edit`} className={buttonVariants({ variant: 'glass', size: 'sm' })}><FileCode2 className="h-4 w-4" />编辑</Link>}
    {isAdmin && version.status === 'PENDING_ENTERPRISE_REVIEW' && <><Button variant="glass-primary" size="sm" onClick={() => onDecide(version.id, 'APPROVE')}><Check className="h-4 w-4" />通过</Button><Button variant="glass" size="sm" onClick={() => onDecide(version.id, 'REJECT')}><X className="h-4 w-4" />驳回</Button></>}
    {isAdmin && version.status === 'ENTERPRISE_APPROVED' && !version.hasPlatformSubmission && <Button variant="glass" size="sm" loading={submitting} onClick={() => onSubmit(version.id)}><Send className="h-4 w-4" />提交平台</Button>}
  </div>;
}
