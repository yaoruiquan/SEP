'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { ENTERPRISE_REVIEW_LABELS, VERSION_TYPE_LABELS, currentUsageLabel, enterpriseReviewLabel, platformProcessingLabel, type MonitorFilters } from './monitor';
import { useSkillMonitor } from './use-skill-monitor';
import { EnterprisePublishedVersions, VersionAttribution } from './version-attribution';

const emptyDraft = { search: '', enterpriseName: '', ownerName: '', createdFrom: '', createdTo: '' };
const platformOptions = { NOT_SUBMITTED: '未收录', PENDING_REVIEW: '待审', APPROVED: '已通过', REJECTED: '已驳回' };

export default function AdminSkillsPage() {
  const [filters, setFilters] = useState<MonitorFilters>({});
  const [draft, setDraft] = useState(emptyDraft);
  const [timeError, setTimeError] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const query = useSkillMonitor(filters, page, limit);
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));
  const change = (key: keyof MonitorFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
    setPage(1);
  };
  useEffect(() => {
    const search = draft.search.trim() || undefined;
    const enterpriseName = draft.enterpriseName.trim() || undefined;
    const ownerName = draft.ownerName.trim() || undefined;
    if (search === filters.search && enterpriseName === filters.enterpriseName && ownerName === filters.ownerName) return;
    const timer = window.setTimeout(() => {
      setFilters((current) => ({ ...current, search, enterpriseName, ownerName }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft.search, draft.enterpriseName, draft.ownerName, filters.search, filters.enterpriseName, filters.ownerName]);
  const changeDate = (key: 'createdFrom' | 'createdTo', value: string) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (next.createdFrom && next.createdTo && next.createdFrom > next.createdTo) {
      setTimeError('开始时间不能晚于结束时间');
      return;
    }
    setTimeError('');
    setFilters((current) => ({ ...current,
      createdFrom: next.createdFrom ? new Date(next.createdFrom).toISOString() : undefined,
      createdTo: next.createdTo ? new Date(next.createdTo).toISOString() : undefined }));
    setPage(1);
  };
  const advancedCount = [filters.enterpriseReviewStatus, filters.enterpriseName, filters.ownerName, filters.createdFrom, filters.createdTo].filter(Boolean).length;
  return (
    <div className="w-full min-w-0 space-y-5 p-4 sm:p-6">
      <Link href="/admin/capabilities" className="inline-flex items-center gap-2 text-sm text-gtext-secondary hover:text-gtext-primary"><ArrowLeft className="h-4 w-4" />返回硅基能力</Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gtext-primary">技能监控</h1>
          <p className="mt-1 text-sm text-gtext-muted">共 {total} 个版本</p>
        </div>
        <Link href="/admin/capabilities/new" className="rounded-md border border-glassline px-4 py-2 text-sm text-gtext-primary hover:bg-glass-1">首次创建技能</Link>
      </header>
      <section aria-label="监控筛选" className="space-y-4 border-y border-glassline py-5">
        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(240px,2fr)_minmax(140px,1fr)_minmax(160px,1fr)_auto]">
          <label className="min-w-0 space-y-1 text-sm text-gtext-secondary">搜索<div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gtext-muted" /><Input aria-label="搜索技能" maxLength={200} value={draft.search} onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))} placeholder="技能名称、提交人或企业名称" className="pl-9" /></div></label>
          <Filter label="版本类型" value={filters.scope ?? ''} options={VERSION_TYPE_LABELS} onChange={(value) => change('scope', value)} />
          <Filter label="平台收录状态" value={filters.platformProcessingStatus ?? ''} options={platformOptions} onChange={(value) => change('platformProcessingStatus', value)} />
          <Button type="button" variant="ghost" className="justify-self-start" onClick={() => { setDraft(emptyDraft); setTimeError(''); setFilters({}); setPage(1); }}><RotateCcw className="h-4 w-4" />重置</Button>
        </div>
        <details className="group border-t border-glassline pt-3">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-2 text-sm text-gtext-secondary"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />高级筛选{advancedCount > 0 && <span className="text-xs text-gbrand-text">· {advancedCount}</span>}</summary>
          <div className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Filter label="企业审核" value={filters.enterpriseReviewStatus ?? ''} options={ENTERPRISE_REVIEW_LABELS} onChange={(value) => change('enterpriseReviewStatus', value)} />
            {([['enterpriseName', '企业名称'], ['ownerName', '提交人']] as const).map(([key, label]) => <label key={key} className="min-w-0 space-y-1 text-sm text-gtext-secondary">{label}<Input maxLength={200} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} placeholder={label} /></label>)}
            {(['createdFrom', 'createdTo'] as const).map((key) => <label key={key} className="min-w-0 space-y-1 text-sm text-gtext-secondary">{key === 'createdFrom' ? '创建开始时间' : '创建结束时间'}<Input type="datetime-local" value={draft[key]} onChange={(event) => changeDate(key, event.target.value)} /></label>)}
          </div>
          {timeError && <p role="alert" className="mt-3 text-sm text-gdanger">{timeError}</p>}
        </details>
      </section>
      <section aria-label="监控版本" className="min-w-0 border-b border-glassline">
        {query.isLoading ? <CenteredSpinner label="加载技能版本..." /> : query.isError ? (
          <div role="alert" className="space-y-3 p-6 text-sm text-gdanger">加载失败：{query.error instanceof Error ? query.error.message : '请稍后重试'}<div><Button variant="glass" onClick={() => void query.refetch()}>重试</Button></div></div>
        ) : query.data?.items.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-left text-sm">
            <caption className="sr-only">技能版本监控，每行是一个版本记录</caption>
            <thead className="border-b border-glassline bg-glass-1 text-gtext-muted"><tr>{['技能 / 版本', '版本类型 / 企业', '提交与审核', '对应企业版本', '企业审核', '平台收录', '当前使用', '创建 / 更新时间', '操作'].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-glassline">{query.data.items.map((row) => (
              <tr key={row.id} className="text-gtext-secondary">
                <td className="max-w-[240px] px-4 py-4"><p className="break-words font-medium text-gtext-primary">{row.capability.name}</p><p className="mt-1 break-all text-xs">v{row.version}</p><p className="mt-1 break-all text-xs text-gtext-muted">技能 ID：{row.capability.id}</p><p className="mt-1 break-all text-xs text-gtext-muted">版本 ID：{row.id}</p></td>
                <td className="max-w-[200px] px-4 py-4"><Badge variant="glass-info">{VERSION_TYPE_LABELS[row.scope]}</Badge><p className="mt-2 break-words">{row.enterprise?.name ?? '无企业归属'}</p></td>
                <td className="max-w-[180px] px-4 py-4"><VersionAttribution version={row} /></td>
                <td className="min-w-[150px] max-w-[180px] px-4 py-4"><EnterprisePublishedVersions version={row} /></td>
                <td className="whitespace-nowrap px-4 py-4">{enterpriseReviewLabel(row)}</td><td className="whitespace-nowrap px-4 py-4">{platformProcessingLabel(row)}</td>
                <td className="whitespace-nowrap px-4 py-4">{currentUsageLabel(row)}</td>
                <td className="px-4 py-4 whitespace-nowrap"><p>{new Date(row.createdAt).toLocaleString('zh-CN')}</p><p className="mt-1 text-xs text-gtext-muted">更新 {new Date(row.updatedAt).toLocaleString('zh-CN')}</p></td>
                <td className="px-4 py-4"><Link className="text-gbrand-text hover:underline" href={`/admin/skills/${row.id}`}>查看来源与处理</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState title="暂无匹配版本" description="调整筛选可查看其他来源、审核状态及历史版本。" />}
      </section>
      <nav aria-label="技能版本分页" className="flex flex-wrap items-center justify-between gap-3 text-sm text-gtext-secondary">
        <div className="flex items-center gap-3"><span>共 {total} 个版本 · 第 {page} / {pages} 页</span><label>每页 <select aria-label="每页条数" value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }} className="rounded border border-glassline bg-glass-1 px-2 py-1">{[20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select> 条</label></div>
        <div className="flex gap-2"><Button variant="glass" disabled={page <= 1 || query.isFetching} onClick={() => setPage((current) => current - 1)}>上一页</Button><Button variant="glass" disabled={page >= pages || query.isFetching || query.isError} onClick={() => setPage((current) => current + 1)}>下一页</Button></div>
      </nav>
    </div>
  );
}
function Filter({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-sm text-gtext-secondary">{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="block h-10 w-full rounded-md border border-glassline bg-glass-1 px-3 text-gtext-primary"><option value="">全部</option>{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
}
