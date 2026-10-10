'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, FileText, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EnterpriseSkillReviewStatus } from '@/lib/types';
import { usePersonalDiffs, useSkillIdentity, type PersonalDiffItem } from './use-capability-iteration';
import { SubmissionDetailDialog } from './submission-detail-dialog';
import { formatDate, type DetailNavigation } from './version-timeline-panel';
import { skillVersionLabel } from './version-source';
import { cn } from '@/lib/utils';
import styles from './skill-detail.module.css';

const STATUSES: Record<string, EnterpriseSkillReviewStatus> = {
  pending: 'PENDING_ENTERPRISE_REVIEW', approved: 'ENTERPRISE_APPROVED', rejected: 'ENTERPRISE_REJECTED',
};

export function PersonalChangesPanel({ capabilityId, currentUserId, initialStatus, initialPage = 1, submissionId, onNavigate }: {
  capabilityId: string;
  currentUserId: string | null;
  initialStatus?: string | null;
  initialPage?: number;
  submissionId?: string | null;
  onNavigate?: DetailNavigation;
}) {
  const [filters, setFilters] = useState({ initialStatus, initialPage, status: initialStatus && STATUSES[initialStatus] ? initialStatus : 'all', page: validPage(initialPage) });
  if (filters.initialStatus !== initialStatus || filters.initialPage !== initialPage) {
    setFilters({ initialStatus, initialPage, status: initialStatus && STATUSES[initialStatus] ? initialStatus : 'all', page: validPage(initialPage) });
  }
  const [localId, setLocalId] = useState<string | null>(null);
  const identity = useSkillIdentity();
  const selectedId = onNavigate ? submissionId ?? null : localId;
  const { data, isLoading, isError, error, refetch, isFetching, isPlaceholderData } = usePersonalDiffs(capabilityId, true, filters.page, STATUSES[filters.status]);
  const navigateFilters = (status: string, page: number) => {
    setFilters({ initialStatus, initialPage, status, page });
    onNavigate?.({ status: status === 'all' ? null : status, page: page === 1 ? null : String(page) });
  };
  const canManage = data?.canManage ?? false;
  const items = (data?.items ?? []).filter((item) => canManage || item.owner?.id === currentUserId);
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / (data?.limit ?? 20)));

  return <section aria-label="提交与审核" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs text-gtext-muted">状态
        <select aria-label="审核状态" value={filters.status} onChange={(event) => navigateFilters(event.target.value, 1)}
          className={styles.select}>
          <option value="all">全部</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option>
        </select></label>
        {!canManage && data && <span className="text-xs text-gtext-muted">我的提交</span>}
      </div>
      {data && <span className="text-xs tabular-nums text-gtext-muted">共 {total} 条{isFetching ? ' · 更新中' : ''}</span>}
    </div>
    {isError && <div role="alert" className="flex items-center justify-between gap-3 py-4 text-xs text-gdanger">
      <span>{error instanceof Error ? error.message : '提交列表加载失败'}</span><Button variant="glass" size="sm" onClick={() => void refetch()}>重试</Button></div>}
    {isLoading ? <div className="h-48 animate-pulse bg-glass-1" /> : data && <>
      <div aria-hidden className={`${styles.tableHeading} hidden grid-cols-[minmax(0,1fr)_90px_145px_90px_120px_95px] gap-4 lg:grid`}>
        <span>提交内容</span><span>提交人</span><span>提交 / 更新时间</span><span>审核状态</span><span>发布结果</span><span className="text-right">操作</span></div>
      <ol className={styles.rows}>
        {items.map((item) => <li key={item.id} className={`${styles.row} grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_90px_145px_90px_120px_95px] lg:items-center`}>
          <div className="min-w-0"><h3 className="break-words text-sm font-medium text-gtext-primary">{submissionTitle(item)}</h3>
            {item.rejectionReason && <p className="mt-1 line-clamp-2 break-words text-xs text-gdanger">{item.rejectionReason}</p>}</div>
          <span className="min-w-0 break-words text-xs text-gtext-secondary">{item.owner?.name || '未知成员'}</span>
          <span className="text-[11px] leading-5 text-gtext-muted">{item.submittedAt ? '提交于' : '更新于'}<time className="ml-1 lg:ml-0 lg:block">{formatDate(item.submittedAt ?? item.updatedAt)}</time></span>
          <span className={cn(styles.status, item.reviewStatus === 'ENTERPRISE_REJECTED' ? styles.rejected : item.pending ? styles.pending : item.reviewStatus === 'ENTERPRISE_APPROVED' ? styles.positive : '')}>{submissionStatus(item)}</span>
          <div className="min-w-0 text-xs text-gtext-muted">{item.publishedVersion ? <ReleaseLink capabilityId={capabilityId} version={item.publishedVersion} onNavigate={onNavigate} /> : item.publishedVersionId ? '发布版本不可查看' : '未发布'}</div>
          <Button variant="glass" size="sm" className={cn(styles.action, canManage && item.pending && styles.enable, 'justify-self-start lg:justify-self-end')} disabled={Boolean(isPlaceholderData)} onClick={() => {
            setLocalId(item.id); onNavigate?.({ submission: item.id });
          }}>{canManage && (item.pending || item.isLegacyUnpublished) ? <><ClipboardCheck className="h-3.5 w-3.5" />审核</> : <><FileText className="h-3.5 w-3.5" />查看详情</>}</Button>
        </li>)}
      </ol>
      {!items.length && <p className="py-12 text-center text-sm text-gtext-muted">{filters.status === 'pending' ? '暂无待审核提交' : filters.status === 'approved' ? '暂无已通过提交' : filters.status === 'rejected' ? '暂无已驳回提交' : '暂无提交记录'}</p>}
      {total > 0 && <div className="flex items-center justify-end gap-3 text-xs text-gtext-muted">
        <Button variant="glass" size="icon" className="h-8 w-8" aria-label="上一页" title="上一页" disabled={filters.page <= 1 || isFetching} onClick={() => navigateFilters(filters.status, filters.page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="tabular-nums">第 {filters.page} / {pageCount} 页</span>
        <Button variant="glass" size="icon" className="h-8 w-8" aria-label="下一页" title="下一页" disabled={filters.page >= pageCount || isFetching} onClick={() => navigateFilters(filters.status, filters.page + 1)}><ChevronRight className="h-4 w-4" /></Button></div>}
    </>}
    {selectedId && <SubmissionDetailDialog key={`${identity}:${selectedId}`} capabilityId={capabilityId} submissionId={selectedId} currentUserId={currentUserId}
      onClose={() => { setLocalId(null); onNavigate?.({ submission: null }); }} onNavigate={onNavigate} />}
  </section>;
}

function validPage(value: number) { return Number.isSafeInteger(value) && value > 0 ? value : 1; }

export function submissionTitle(item: PersonalDiffItem) {
  return item.changeSummary?.split('\n').map((line) => line.trim()).find(Boolean) || (item.isWorkingCopy ? '历史 Web 副本' : '技能修改提交');
}

export function submissionStatus(item: PersonalDiffItem) {
  if (item.isLegacyUnpublished) return '历史通过未发布';
  if (item.reviewStatus === 'ENTERPRISE_REJECTED') return '已驳回';
  if (item.reviewStatus === 'ENTERPRISE_APPROVED') return '已通过';
  if (!item.pending) return '未送审';
  return '待审核';
}

export function ReleaseLink({ capabilityId, version, onNavigate }: {
  capabilityId: string;
  version: { id: string; scope: 'PLATFORM' | 'ENTERPRISE' | 'PERSONAL'; version: string };
  onNavigate?: DetailNavigation;
}) {
  return <Link href={`/capabilities/${capabilityId}?tab=versions&release=${encodeURIComponent(version.id)}`} className="break-words text-gbrand-text hover:underline"
    onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate({ tab: 'versions', release: version.id, submission: null }); } : undefined}>{skillVersionLabel(version)}</Link>;
}
