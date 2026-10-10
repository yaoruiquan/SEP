'use client';

import { useState, type FormEvent } from 'react';
import { Check, FileText, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { ReviewSkillVersionDtoSchema } from '../../../../backend/src/shared/skill-version.dto';
import { PageFrame } from '@/components/page/page-frame';
import { PageHero } from '@/components/page/page-hero';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CenteredSpinner, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Input, Textarea } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { personalSourceLabel } from '@/features/capability-iteration/version-source';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import type { EnterpriseSkillReviewStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SkillVersionPreviewDialog } from './SkillVersionPreviewDialog';
import { SKILL_VERSION_STATUS } from './status';
import { type EnterpriseReviewItem, useEnterpriseSkillVersionReviews, useReviewEnterprisePersonalSkillVersion } from './use-skill-version';

const FILTERS: Array<{ status: EnterpriseSkillReviewStatus; label: string }> = [
  { status: 'PENDING_ENTERPRISE_REVIEW', label: '待审核' },
  { status: 'ENTERPRISE_APPROVED', label: '已通过' },
  { status: 'ENTERPRISE_REJECTED', label: '已驳回' },
];

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

export default function EnterpriseSkillReviewPage() {
  const { enterprise, roleInEnterprise } = useAuthStore();
  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';
  const [status, setStatus] = useState<EnterpriseSkillReviewStatus>('PENDING_ENTERPRISE_REVIEW');
  const [page, setPage] = useState(1);
  const [capabilityInput, setCapabilityInput] = useState('');
  const [capabilityId, setCapabilityId] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [rejectItem, setRejectItem] = useState<EnterpriseReviewItem | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const query = useEnterpriseSkillVersionReviews({
    enterpriseId: enterprise?.id ?? null, status, page, limit: 20, capabilityId: capabilityId || undefined,
  }, isAdmin);
  const review = useReviewEnterprisePersonalSkillVersion();

  const submitReview = (id: string, decision: 'APPROVE' | 'REJECT', comment?: string) => {
    const validated = ReviewSkillVersionDtoSchema.safeParse({ decision, comment });
    if (!validated.success) {
      setReasonError(validated.error.issues[0]?.message ?? '请检查审核信息');
      return;
    }
    const item = query.data?.items.find((candidate) => candidate.id === id);
    review.mutate({ id, ...validated.data, ...(item?.isWorkingCopy ? { expectedUpdatedAt: item.updatedAt } : {}) }, {
      onSuccess: () => {
        setRejectItem(null);
        toast.success(decision === 'APPROVE' ? '审核通过并启用' : '已驳回个人版本',
          decision === 'APPROVE' ? '企业版本已生成并自动启用。' : undefined);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          setRejectItem(null);
          void query.refetch();
          toast.error('该版本已审核', '已刷新队列，请查看最新审核结果。');
        } else {
          toast.error(error instanceof ApiError && error.status === 403
            ? '仅企业管理员可审核本企业的个人版本'
            : error instanceof Error ? error.message : '审核失败，请稍后重试');
        }
      },
    });
  };

  const applyFilter = (event: FormEvent) => {
    event.preventDefault();
    setCapabilityId(capabilityInput.trim());
    setPage(1);
  };

  if (!isAdmin || !enterprise) {
    return (
      <PageFrame>
        <PageHero title="技能审核" description="企业内个人 Skill 版本审核" />
        <EmptyState icon={<ShieldCheck className="h-10 w-10" />} title="仅企业管理员可审核"
          description="请使用所属企业的管理员身份。平台管理员身份不能代替企业管理员。" />
      </PageFrame>
    );
  }

  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));
  return (
    <PageFrame className="min-w-0">
      <PageHero title="技能审核"
        actions={<Button variant="glass" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />刷新
        </Button>} />
      <section className="min-w-0 rounded-xl border border-border bg-card shadow-sm" aria-label="企业个人技能审核队列">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="审核状态筛选">
            {FILTERS.map((filter) => (
              <Button key={filter.status} size="sm" variant={status === filter.status ? 'glass-primary' : 'glass'}
                aria-pressed={status === filter.status} disabled={review.isPending}
                onClick={() => { setStatus(filter.status); setPage(1); }}>
                {filter.label}
              </Button>
            ))}
          </div>
          <form onSubmit={applyFilter} className="flex w-full items-center gap-2 sm:w-auto">
            <label className="min-w-0 flex-1 sm:w-64">
              <span className="sr-only">技能 ID</span>
              <Input value={capabilityInput} onChange={(event) => setCapabilityInput(event.target.value)}
                maxLength={128} placeholder="按技能 ID 精确筛选" disabled={review.isPending} />
            </label>
            <Button type="submit" variant="glass" size="sm" disabled={review.isPending}>筛选</Button>
            {capabilityId && <Button type="button" variant="glass" size="sm" disabled={review.isPending}
              onClick={() => { setCapabilityInput(''); setCapabilityId(''); setPage(1); }}>清除</Button>}
          </form>
        </div>
        {query.isLoading ? <CenteredSpinner label="加载个人 Skill 审核队列..." /> : query.isError ? (
          <ErrorState title={query.error instanceof ApiError && query.error.status === 403 ? '仅企业管理员可审核' : '审核队列加载失败'}
            message={query.error instanceof ApiError && query.error.status === 403
              ? '请确认当前企业身份；平台管理员不能代替企业管理员。'
              : query.error instanceof Error ? query.error.message : '无法获取审核记录，请稍后重试。'}
            onRetry={() => void query.refetch()} />
        ) : !query.data?.items.length ? (
          <EmptyState icon={<ShieldCheck className="h-10 w-10" />} title="暂无符合条件的审核记录"
            description="暂无符合筛选条件的个人提交或历史 Web 副本。" />
        ) : (
          <ul className="divide-y divide-border">
            {query.data.items.map((item) => {
              const meta = SKILL_VERSION_STATUS[item.status];
              return (
                <li key={item.id} className="min-w-0 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words text-base font-semibold text-gtext-primary">{item.capability?.name || item.capabilityId}</h2>
                        <Badge className={meta.className}>{meta.label}</Badge>
                        <Badge variant="glass">个人版本</Badge>
                      </div>
                      <p className="text-xs text-gtext-muted">来源：{personalSourceLabel(item)}</p>
                      <p className="break-all text-xs text-gtext-muted">技能 ID：{item.capabilityId}</p>
                      <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <div className="min-w-0"><dt className="text-xs text-gtext-muted">提交人</dt>
                          <dd className="mt-1 break-all text-gtext-secondary">{item.owner?.name || item.owner?.email || item.ownerId || '未知提交人'}</dd>
                          {item.ownerId && <dd className="mt-1 break-all text-xs text-gtext-muted">{item.ownerId}</dd>}
                        </div>
                        <div className="min-w-0"><dt className="text-xs text-gtext-muted">版本</dt><dd className="mt-1 break-all text-gtext-secondary">{item.version}</dd></div>
                        <div><dt className="text-xs text-gtext-muted">提交时间</dt><dd className="mt-1 text-gtext-secondary">{formatTime(item.submittedAt)}</dd></div>
                        {item.enterpriseReviewedAt && <div><dt className="text-xs text-gtext-muted">审核时间</dt><dd className="mt-1 text-gtext-secondary">{formatTime(item.enterpriseReviewedAt)}</dd></div>}
                      </dl>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gtext-secondary">变更说明：{item.changeSummary || '未填写'}</p>
                      {item.rejectionReason && <p className="whitespace-pre-wrap break-words rounded-md bg-gdanger/5 p-3 text-sm text-gdanger">驳回原因：{item.rejectionReason}</p>}
                      <p className="break-all font-mono text-[11px] text-gtext-muted">版本 ID：{item.id}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button size="sm" variant="glass" onClick={() => setPreviewId(item.id)}><FileText className="h-4 w-4" />查看内容</Button>
                      {item.status === 'PENDING_ENTERPRISE_REVIEW' && <>
                        <Button size="sm" variant="glass-primary" disabled={review.isPending}
                          onClick={() => submitReview(item.id, 'APPROVE')}><Check className="h-4 w-4" />通过并启用</Button>
                        <Button size="sm" variant="glass-danger" disabled={review.isPending}
                          onClick={() => { setRejectItem(item); setReason(''); setReasonError(''); }}><X className="h-4 w-4" />驳回</Button>
                      </>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {query.data && !query.isError && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-xs text-gtext-muted">
          <p>共 {query.data.total} 条 · 第 {page} / {totalPages} 页 · 前台每 30 秒刷新</p>
          <div className="flex gap-2">
            <Button variant="glass" size="sm" disabled={page <= 1 || query.isFetching || review.isPending} onClick={() => setPage(page - 1)}>上一页</Button>
            <Button variant="glass" size="sm" disabled={page >= totalPages || query.isFetching || review.isPending} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>}
      </section>
      {previewId && <SkillVersionPreviewDialog versionId={previewId} source="enterprise" open
        onOpenChange={(open) => { if (!open) setPreviewId(null); }} />}
      <Dialog open={Boolean(rejectItem)} onOpenChange={(open) => { if (!open && !review.isPending) setRejectItem(null); }}>
        <DialogContent glass className="max-w-lg">
          <DialogHeader>
            <DialogTitle>驳回个人 Skill 版本</DialogTitle>
            <DialogDescription>确认驳回此版本？</DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm text-gtext-secondary" htmlFor="skill-review-reason">
            驳回原因
            <Textarea id="skill-review-reason" glass value={reason} maxLength={2000} disabled={review.isPending}
              aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? 'skill-review-reason-error' : undefined}
              onChange={(event) => { setReason(event.target.value); setReasonError(''); }}
              placeholder="请填写具体的修改建议" className="mt-2 min-h-28" />
          </label>
          {reasonError && <p id="skill-review-reason-error" role="alert" className="text-xs text-gdanger">{reasonError}</p>}
          <DialogFooter>
            <Button variant="glass" onClick={() => setRejectItem(null)} disabled={review.isPending}>取消</Button>
            <Button variant="glass-danger" loading={review.isPending} disabled={review.isPending}
              onClick={() => { if (rejectItem) submitReview(rejectItem.id, 'REJECT', reason); }}>确认驳回</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
