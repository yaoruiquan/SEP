'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReviewEnterprisePersonalSkillVersion } from '@/features/skill-version/use-skill-version';
import { cn } from '@/lib/utils';
import { diffLines } from './diff-lines';
import { personalSourceLabel, skillVersionLabel } from './version-source';
import { useSkillSubmissionDetail, type SkillSubmissionDetail } from './use-capability-iteration';
import { ReleaseLink, submissionStatus, submissionTitle } from './personal-changes-panel';
import { formatDate, type DetailNavigation } from './version-timeline-panel';
import styles from './skill-detail.module.css';

export function SubmissionDetailDialog({ capabilityId, submissionId, currentUserId, onClose, onNavigate }: {
  capabilityId: string; submissionId: string; currentUserId: string | null; onClose: () => void; onNavigate?: DetailNavigation;
}) {
  const query = useSkillSubmissionDetail(capabilityId, submissionId);
  const review = useReviewEnterprisePersonalSkillVersion();
  const [snapshot, setSnapshot] = useState<SkillSubmissionDetail | null>(null);
  const [comparison, setComparison] = useState('source');
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [comment, setComment] = useState('');
  const [processed, setProcessed] = useState(false);
  if (query.data && !snapshot) setSnapshot(query.data);
  const data = processed ? query.data : snapshot;
  const authorized = Boolean(!query.isError && data && (data.canManage || data.item.owner?.id === currentUserId));
  const changed = Boolean(data && query.data && (data.item.updatedAt !== query.data.item.updatedAt
    || data.item.content !== query.data.item.content || data.item.pending !== query.data.item.pending
    || data.item.reviewStatus !== query.data.item.reviewStatus || data.item.publishedVersionId !== query.data.item.publishedVersionId
    || data.currentBaseline?.id !== query.data.currentBaseline?.id
    || data.currentBaselineState !== query.data.currentBaselineState));
  const canReview = authorized && data?.canManage && (data.item.pending || data.item.isLegacyUnpublished) && !processed;
  const blocked = changed || query.isError || review.isPending || query.isFetching;
  const confirm = () => {
    if (!data || !decision || !canReview || blocked || (decision === 'REJECT' && !comment.trim())) return;
    review.mutate({ id: data.item.id, decision, comment: comment.trim() || undefined,
      ...(data.item.isWorkingCopy ? { expectedUpdatedAt: data.item.updatedAt } : {}) }, {
      onSuccess: () => { setProcessed(true); setDecision(null); toast.success(decision === 'APPROVE' ? '审核通过并启用' : '已驳回'); void query.refetch(); },
      onError: (error) => {
        toast.error('审核失败', error.message);
        if ('status' in error && error.status === 409) { setDecision(null); void query.refetch(); }
      },
    });
  };
  const refresh = async () => {
    const result = await query.refetch();
    if (result.data && !result.isError) { setSnapshot(result.data); setDecision(null); setComment(''); }
  };
  const baseline = comparison === 'source' ? data?.source : data?.currentBaseline;
  return <Dialog open onOpenChange={(open) => { if (!open && !review.isPending) onClose(); }}>
    <DialogContent glass className="flex max-h-[92dvh] w-[calc(100%-24px)] max-w-5xl flex-col gap-0 overflow-hidden p-0"
      onEscapeKeyDown={(event) => { if (review.isPending) event.preventDefault(); }} onInteractOutside={(event) => { if (review.isPending) event.preventDefault(); }}>
      <DialogHeader className={`${styles.dialogHeader} shrink-0 border-b border-glassline px-5 py-5 pr-10`}>
        <DialogTitle className="break-words text-base tracking-normal">{authorized && data ? submissionTitle(data.item) : '提交详情'}</DialogTitle>
        <DialogDescription>{authorized && data ? `${data.item.owner?.name || '未知成员'} · ${data.item.submittedAt ? '提交于' : '更新于'} ${formatDate(data.item.submittedAt ?? data.item.updatedAt)} · ${personalSourceLabel(data.item)}` : '提交与审核'}</DialogDescription>
      </DialogHeader>
      {(query.isLoading || !data) && !query.isError && <div className="h-72 animate-pulse bg-glass-1" />}
      {query.isError && <div role="alert" className="flex items-center justify-between gap-2 px-5 py-5 text-sm text-gdanger"><span>{query.error instanceof Error ? query.error.message : '提交详情加载失败'}</span><Button size="sm" variant="glass" onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" />重试</Button></div>}
      {data && !authorized && <p className="px-5 py-8 text-sm text-gtext-muted">无权查看此提交</p>}
      {authorized && data && <>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gtext-muted">
            <span className={cn(styles.status, data.item.reviewStatus === 'ENTERPRISE_REJECTED' ? styles.rejected : data.item.pending ? styles.pending : data.item.reviewStatus === 'ENTERPRISE_APPROVED' ? styles.positive : '')}>{submissionStatus(data.item)}</span>
            <span>来源版本：{data.source ? skillVersionLabel(data.source) : data.sourceState === 'UNREADABLE' ? '当前不可查看' : '未记录'}</span>
            {data.item.publishedVersion && <span>发布结果：<ReleaseLink capabilityId={capabilityId} version={data.item.publishedVersion} onNavigate={onNavigate} />{data.item.publishedVersion.isCurrent && ' · 当前启用'}</span>}
          </div>
          {data.item.changeSummary && <p className="mb-4 whitespace-pre-wrap break-words text-xs leading-5 text-gtext-secondary">{data.item.changeSummary}</p>}
          {changed && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 border-l-2 border-gdanger pl-3 text-xs text-gdanger">
            <span>提交或当前启用版本已变化，请刷新并重新预览后审核</span><Button variant="glass" size="sm" disabled={query.isFetching} onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" />刷新预览</Button></div>}
          <Tabs defaultValue="diff">
            <TabsList aria-label="提交详情内容" className={`${styles.tabs} h-auto max-w-full`}>
              {[['diff', '内容差异'], ['content', '完整内容'], ['history', '处理记录']].map(([value, label]) => <TabsTrigger key={value} value={value}
                className={`${styles.tab} text-xs`}>{label}</TabsTrigger>)}
            </TabsList>
            <TabsContent value="diff" className="mt-4">
              <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gtext-muted">对比对象
                <select aria-label="对比对象" value={comparison} onChange={(event) => setComparison(event.target.value)} className={`${styles.select} max-w-full`}>
                  <option value="source">提交来源版本</option><option value="current">当前启用版本</option></select>
                {baseline && <span>{skillVersionLabel(baseline)}</span>}</label>
              {comparison === 'source' && data.source && data.currentBaseline && data.source.id !== data.currentBaseline.id && <p className="mb-3 text-xs leading-5 text-gtext-muted">提交来源与当前启用版本不同。通过后将发布并完整替换当前执行内容，不会自动合并差异。</p>}
              {baseline ? <DiffView baseline={baseline.content} current={data.item.content} /> : <p className="py-8 text-sm text-gtext-muted">
                {comparison === 'source' ? data.sourceState === 'UNREADABLE' ? '来源版本当前不可查看，无法展示历史差异' : '此提交未记录来源版本，无法展示历史差异' : data.currentBaselineState === 'MIXED' ? '当前各员工使用不同版本，没有统一对比基线' : '暂无当前启用版本可供对比'}</p>}
            </TabsContent>
            <TabsContent value="content" className="mt-4"><section aria-label="完整正文"><pre className="max-h-[45dvh] overflow-auto whitespace-pre-wrap break-words bg-glass-2 p-3 font-mono text-xs leading-6 text-gtext-secondary">{data.item.content}</pre></section></TabsContent>
            <TabsContent value="history" className="mt-4">
              {data.item.submittedAt && <p className="border-b border-glassline py-3 text-xs text-gtext-muted">提交于 {formatDate(data.item.submittedAt)}</p>}
              {!data.reviews.length ? <p className="py-8 text-sm text-gtext-muted">暂无审核记录</p> : <ol className="divide-y divide-glassline">{data.reviews.map((record) => <li key={record.id} className="py-3 text-xs leading-5">
                <div className="flex flex-wrap gap-x-4 gap-y-1"><span className={record.decision === 'APPROVE' ? 'text-gsuccess' : 'text-gdanger'}>{record.decision === 'APPROVE' ? '企业审核通过' : '企业驳回'}</span><span className="break-words text-gtext-secondary">{record.reviewer.name || record.reviewer.id}</span><time className="text-gtext-muted">{formatDate(record.createdAt)}</time></div>
                {data.item.isWorkingCopy && record.version && <p className="mt-1 break-all text-gtext-muted">审核修订：<code>{record.version}</code></p>}
                <p className="mt-1 whitespace-pre-wrap break-words text-gtext-secondary">{record.comment || '未填写审核意见'}</p>
                {record.publishedVersion && <p className="mt-1 text-gtext-muted">发布结果：<ReleaseLink capabilityId={capabilityId} version={record.publishedVersion} onNavigate={onNavigate} /></p>}
              </li>)}</ol>}
              {data.item.rejectionReason && <p className="mt-3 whitespace-pre-wrap break-words text-xs text-gdanger">驳回原因：{data.item.rejectionReason}</p>}
            </TabsContent>
          </Tabs>
          <details className="mt-5 border-t border-glassline pt-3 text-xs text-gtext-muted"><summary className="cursor-pointer">技术信息</summary>
            <TechnicalValue label="提交 ID" value={data.item.id} /><TechnicalValue label="内部版本" value={data.item.version} /></details>
        </div>
        {canReview && <footer className="shrink-0 space-y-3 border-t border-glassline px-5 py-4">
          <label className="block text-xs text-gtext-muted">{decision === 'REJECT' ? '驳回原因（必填）' : '审核意见（选填）'}
            <Textarea aria-label={decision === 'REJECT' ? '驳回原因' : '审核意见'} value={comment} maxLength={2000} disabled={review.isPending} onChange={(event) => setComment(event.target.value)} className="mt-2 min-h-16 text-xs" /></label>
          {decision && <p className="text-xs leading-5 text-gtext-secondary">{decision === 'APPROVE' ? '确认通过并启用此提交？将生成企业版本并切换所有相关员工的执行版本。' : '确认驳回此提交？当前启用版本不会改变。'}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {decision ? <><Button size="sm" variant="glass" disabled={review.isPending} onClick={() => setDecision(null)}>取消</Button>
              <Button size="sm" variant="glass-primary" disabled={blocked || (decision === 'REJECT' && !comment.trim())} onClick={confirm}>
                {decision === 'APPROVE' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{review.isPending ? '处理中...' : decision === 'APPROVE' ? '确认通过并启用' : '确认驳回'}</Button></> : <>
              <Button size="sm" variant="glass" disabled={blocked} onClick={() => setDecision('REJECT')}><X className="h-3.5 w-3.5" />驳回</Button>
              <Button size="sm" variant="glass-primary" disabled={blocked} onClick={() => setDecision('APPROVE')}><Check className="h-3.5 w-3.5" />通过并启用</Button></>}
          </div>
        </footer>}
      </>}
    </DialogContent>
  </Dialog>;
}

function TechnicalValue({ label, value }: { label: string; value: string }) {
  return <div className="mt-2 flex min-w-0 items-start gap-2"><span className="shrink-0">{label}：</span><code className="min-w-0 flex-1 break-all">{value}</code>
    <Button size="icon" variant="glass" className="h-6 w-6 shrink-0" aria-label={`复制${label}`} title={`复制${label}`} onClick={() => {
      void navigator.clipboard.writeText(value).then(() => toast.success('已复制'), () => toast.error('复制失败'));
    }}><Copy className="h-3 w-3" /></Button></div>;
}

function DiffView({ baseline, current }: { baseline: string; current: string }) {
  const rows = useMemo(() => diffLines(baseline, current), [baseline, current]);
  if (!rows.some((row) => row.type !== 'same')) return <p className="py-8 text-sm text-gtext-muted">与所选对比版本内容相同</p>;
  return <section aria-label="正文差异" className="max-h-[45dvh] overflow-auto bg-glass-2 font-mono text-xs leading-6">{rows.map((row, index) =>
    <div key={`${index}-${row.type}`} className={cn('whitespace-pre-wrap break-words px-3', row.type === 'added' && 'bg-gsuccess/10 text-gsuccess', row.type === 'removed' && 'bg-gdanger/10 text-gdanger', row.type === 'same' && 'text-gtext-muted', row.type === 'gap' && 'bg-glass-3 text-center text-gtext-disabled')}>
      {row.type === 'gap' ? '...' : `${row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '} ${row.text}`}</div>)}</section>;
}
