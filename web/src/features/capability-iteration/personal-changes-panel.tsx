'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  GitCompare,
  UserRound,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReviewEnterprisePersonalSkillVersion } from '@/features/skill-version/use-skill-version';
import type { EnterpriseSkillReviewStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { diffLines } from './diff-lines';
import { personalSourceLabel } from './version-source';
import {
  usePersonalDiffs,
  type PersonalDiffItem,
} from './use-capability-iteration';

/** Web 工作副本和客户端提交共用审核入口；预览固定本次审核的内容。 */
export function PersonalChangesPanel({
  capabilityId,
  currentUserId,
}: {
  capabilityId: string;
  currentUserId: string | null;
}) {
  const [filters, setFilters] = useState<{ status: 'ALL' | EnterpriseSkillReviewStatus; page: number }>({ status: 'ALL', page: 1 });
  const { data, isLoading, isError, error, refetch, isFetching, isPlaceholderData } = usePersonalDiffs(capabilityId, true, filters.page,
    filters.status === 'ALL' ? undefined : filters.status);
  const review = useReviewEnterprisePersonalSkillVersion();
  const [preview, setPreview] = useState<{ item: PersonalDiffItem; baseline: string } | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [comment, setComment] = useState('');

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-glass-lg border border-glassline bg-glass-1" />;
  }

  if (isError) {
    return (
      <p className="rounded-glass-lg border border-gdanger/25 bg-gdanger/[0.06] px-4 py-6 text-center text-sm text-gdanger">
        {error instanceof Error ? error.message : '改动列表加载失败'}
      </p>
    );
  }

  const canManage = data?.canManage ?? false;
  const items = data?.items ?? [];
  const mine = data?.myWorkingCopy !== undefined ? data.myWorkingCopy ?? undefined
    : items.find((item) => item.owner?.id === currentUserId && item.isWorkingCopy);
  const visibleItems = canManage ? items : items.filter((item) => item.owner?.id === currentUserId);
  const total = data?.total ?? items.length;
  const pageCount = Math.max(1, Math.ceil(total / (data?.limit ?? 20)));
  const currentPage = data?.page ?? filters.page;
  const latestPreviewItem = mine?.id === preview?.item.id ? mine : items.find((item) => item.id === preview?.item.id);
  const previewChanged = Boolean(preview && (!latestPreviewItem
    || latestPreviewItem.updatedAt !== preview.item.updatedAt
    || latestPreviewItem.content !== preview.item.content
    || latestPreviewItem.reviewStatus !== preview.item.reviewStatus
    || latestPreviewItem.pending !== preview.item.pending
    || latestPreviewItem.publishedVersionId !== preview.item.publishedVersionId));
  const confirmReview = () => {
    if (!canManage || !preview || !decision || previewChanged || review.isPending) return;
    if (decision === 'REJECT' && !comment.trim()) return;
    review.mutate(
      {
        id: preview.item.id,
        decision,
        comment: comment.trim() || undefined,
        ...(preview.item.isWorkingCopy ? { expectedUpdatedAt: preview.item.updatedAt } : {}),
      },
      {
        onSuccess: (result) => {
          toast.success(decision === 'APPROVE' ? '审核通过并启用' : '已驳回',
            result.publishedVersionId ? '企业版本已生成并自动启用' : undefined);
          setPreview(null);
          setDecision(null);
        },
        onError: (err) => {
          toast.error('审核失败', err.message);
          if ('status' in err && err.status === 409) {
            setPreview(null);
            setDecision(null);
            void refetch();
          }
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      {mine && !visibleItems.some((item) => item.id === mine.id) && (canManage || mine.owner?.id === currentUserId) && (
        <section aria-label="历史 Web 副本">
          <ChangeCard item={mine} baselineContent={data?.baseline?.content ?? ''} canManage={canManage}
            reviewing={review.isPending || Boolean(isPlaceholderData)}
            onPreview={() => { setPreview({ item: { ...mine }, baseline: data?.baseline?.content ?? '' }); setDecision(null); setComment(''); }} />
        </section>
      )}

      {(canManage || total > 0 || filters.status !== 'ALL' || filters.page > 1) && (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gtext-primary">{canManage ? '大家的改动' : '我的提交记录'}</h3>
            <label className="flex items-center gap-2 text-xs text-gtext-muted">
              审核状态
              <select aria-label="审核状态" value={filters.status} disabled={isFetching || review.isPending} onChange={(event) => setFilters({ status: event.target.value as typeof filters.status, page: 1 })}
                className="h-8 rounded-md border border-glassline bg-glass-1 px-2 text-gtext-primary">
                <option value="ALL">全部</option>
                <option value="PENDING_ENTERPRISE_REVIEW">待审核</option>
                <option value="ENTERPRISE_APPROVED">已通过</option>
                <option value="ENTERPRISE_REJECTED">已驳回</option>
              </select>
            </label>
          </div>

          {visibleItems.length === 0 ? (
            <p className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-8 text-center text-xs text-gtext-muted">
              暂无符合条件的改动
            </p>
          ) : (
            <div className="space-y-2">
              {visibleItems.map((item) => (
                <ChangeCard
                  key={item.id}
                  item={item}
                  baselineContent={data?.baseline?.content ?? ''}
                  canManage={canManage}
                  onPreview={() => {
                    setPreview({ item: { ...item }, baseline: data?.baseline?.content ?? '' });
                    setDecision(null);
                    setComment('');
                  }}
                  reviewing={review.isPending || Boolean(isPlaceholderData)}
                />
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gtext-muted">
            <span>共 {total} 条 · 第 {currentPage} / {pageCount} 页</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="glass" aria-label="上一页" title="上一页" disabled={currentPage <= 1 || review.isPending || isFetching}
                onClick={() => setFilters((previous) => ({ ...previous, page: Math.max(1, currentPage - 1) }))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="glass" aria-label="下一页" title="下一页" disabled={currentPage >= pageCount || review.isPending || isFetching}
                onClick={() => setFilters((previous) => ({ ...previous, page: currentPage + 1 }))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      )}
      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open && !review.isPending) setPreview(null); }}>
        {preview && (
          <DialogContent glass className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>审核预览 · {preview.item.owner?.name ?? '我的改动'}</DialogTitle>
              <DialogDescription>{personalSourceLabel(preview.item)} · {reviewLabel(preview.item)}</DialogDescription>
            </DialogHeader>
            <ReviewMetadata item={preview.item} />
            <section aria-label="正文差异">
              <h4 className="text-xs font-semibold">正文差异</h4>
              <DiffView baseline={preview.baseline} current={preview.item.content} />
            </section>
            <section aria-label="完整正文">
              <h4 className="text-xs font-semibold">完整正文</h4>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-glass-2 p-3 text-xs">{preview.item.content}</pre>
            </section>
            {previewChanged && <p role="alert" className="text-xs text-gdanger">内容或审核状态已变化，请关闭后重新预览再审核。</p>}
            {canManage && (preview.item.pending || preview.item.isLegacyUnpublished) && !decision && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="glass-primary" disabled={previewChanged || review.isPending} onClick={() => setDecision('APPROVE')}>
                  <Check className="h-4 w-4" />{preview.item.isLegacyUnpublished ? '通过并启用' : '审核通过'}
                </Button>
                {!preview.item.isLegacyUnpublished && <Button size="sm" variant="glass" disabled={previewChanged || review.isPending} onClick={() => setDecision('REJECT')}>
                  <X className="h-4 w-4" />驳回
                </Button>}
              </div>
            )}
            {decision && (
              <div className="space-y-3 border-t border-glassline pt-3">
                <p className="text-xs text-gtext-secondary">{decision === 'APPROVE'
                  ? '确认通过并启用此版本？'
                  : '确认驳回这份改动？'}</p>
                <label className="block text-xs text-gtext-secondary">
                  {decision === 'REJECT' ? '驳回原因（必填）' : '审核意见（选填）'}
                  <Textarea glass aria-label={decision === 'REJECT' ? '驳回原因' : '审核意见'} value={comment} maxLength={2000}
                    disabled={review.isPending} onChange={(event) => setComment(event.target.value)} className="mt-2 min-h-20" />
                </label>
                <div className="flex gap-2">
                  <Button size="sm" variant="glass-primary" loading={review.isPending}
                    disabled={previewChanged || (decision === 'REJECT' && !comment.trim())} onClick={confirmReview}>
                    {decision === 'APPROVE' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    {decision === 'APPROVE' ? '确认通过并启用' : '确认驳回'}
                  </Button>
                  <Button size="sm" variant="glass" disabled={review.isPending} onClick={() => setDecision(null)}>返回预览</Button>
                </div>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function ChangeCard({
  item,
  baselineContent,
  canManage,
  onPreview,
  reviewing,
}: {
  item: PersonalDiffItem;
  baselineContent: string;
  canManage: boolean;
  onPreview: () => void;
  reviewing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-glass-lg border border-glassline bg-glass-1 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gtext-primary">
          <UserRound className="h-3.5 w-3.5 text-gtext-muted" />
          {item.owner?.name ?? '未知成员'}
        </span>
        <span className="text-[11px] text-gtext-muted">{personalSourceLabel(item)}</span>
        <span className={cn('rounded-glass-pill px-1.5 py-0.5 text-[10px]',
          item.reviewStatus === 'ENTERPRISE_REJECTED' ? 'bg-gdanger/10 text-gdanger'
            : item.pending || item.isLegacyUnpublished ? 'bg-gbrand/15 text-gbrand-text' : 'bg-gsuccess/10 text-gsuccess')}>
          {reviewLabel(item)}
        </span>
        <span className="text-[11px] text-gtext-muted">
          {new Date(item.updatedAt).toLocaleString('zh-CN')}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[11px] text-gtext-secondary underline-offset-2 hover:underline"
          >
            <GitCompare className="h-3 w-3" />
            {expanded ? '收起差异' : '看差异'}
          </button>
          <Button size="sm" variant="glass" disabled={reviewing} onClick={onPreview} className="h-7 px-2.5 text-[11px]">
            <GitCompare className="h-3 w-3" />
            {canManage && (item.pending || item.isLegacyUnpublished) ? '预览并审核' : '预览正文'}
          </Button>
        </div>
      </div>

      {item.changeSummary && (
        <p className="mt-1.5 text-xs leading-5 text-gtext-secondary">{item.changeSummary}</p>
      )}
      {item.rejectionReason && <p className="mt-2 break-words text-xs text-gdanger">驳回原因：{item.rejectionReason}</p>}
      <ReviewMetadata item={item} />
      {item.submittedAt && <p className="mt-1 text-[11px] text-gtext-muted">提交时间：{new Date(item.submittedAt).toLocaleString('zh-CN')}</p>}
      {item.publishedVersionId && <p className="mt-1 break-all text-[11px] text-gtext-muted">企业版本：{item.publishedVersionId}</p>}

      {expanded && <DiffView baseline={baselineContent} current={item.content} />}
    </div>
  );
}

function ReviewMetadata({ item }: { item: PersonalDiffItem }) {
  if (!item.reviewedBy && !item.enterpriseReviewedAt) return null;

  return (
    <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[11px] text-gtext-muted">
      {item.reviewedBy && <p className="min-w-0 break-all">审核人：{item.reviewedBy.name ?? item.reviewedBy.id}</p>}
      {item.enterpriseReviewedAt && <p className="min-w-0 break-words">审核时间：{new Date(item.enterpriseReviewedAt).toLocaleString('zh-CN')}</p>}
    </div>
  );
}

function reviewLabel(item: PersonalDiffItem): string {
  if (item.isLegacyUnpublished) return '历史通过未发布';
  if (item.reviewStatus === 'ENTERPRISE_REJECTED') return '已驳回';
  if (item.reviewStatus === 'ENTERPRISE_APPROVED') return '已通过';
  return item.adopted ? '审核后又有改动 · 待审核' : '待审核';
}

/**
 * 行级差异。
 *
 * 只显示变化的行及其上下文 —— 技能正文动辄几百行，全文并排看不出改了哪。
 * 没有引入 diff 库：`diffLines` 是 40 行的 LCS，够用且不增加依赖。
 */
function DiffView({ baseline, current }: { baseline: string; current: string }) {
  const rows = useMemo(() => diffLines(baseline, current), [baseline, current]);
  const changed = rows.filter((row) => row.type !== 'same').length;

  if (!baseline) {
    return (
      <pre className="mt-2 max-h-72 overflow-auto rounded-glass-md bg-glass-2 p-2.5 font-mono text-[11px] leading-5 text-gtext-secondary">
        {current}
      </pre>
    );
  }

  if (changed === 0) {
    return (
      <p className="mt-2 rounded-glass-md bg-glass-2 px-2.5 py-2 text-[11px] text-gtext-muted">
        与当前生效版本内容相同
      </p>
    );
  }

  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-glass-md bg-glass-2 font-mono text-[11px] leading-5">
      {rows.map((row, index) => (
        <div
          key={`${index}-${row.type}`}
          className={cn(
            'whitespace-pre-wrap break-all px-2.5',
            row.type === 'added' && 'bg-gsuccess/10 text-gsuccess',
            row.type === 'removed' && 'bg-gdanger/10 text-gdanger line-through decoration-1',
            row.type === 'same' && 'text-gtext-muted',
            row.type === 'gap' && 'select-none bg-glass-3 text-center text-gtext-disabled',
          )}
        >
          {row.type === 'gap' ? '⋯' : `${row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '} ${row.text}`}
        </div>
      ))}
    </div>
  );
}

function scopeLabel(scope: string) {
  if (scope === 'ENTERPRISE') return '企业版';
  if (scope === 'PERSONAL') return '个人副本';
  return '平台版';
}
