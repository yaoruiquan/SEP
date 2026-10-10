'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, FileText, ArrowUpRight, Building2, Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { SkillVersionPreviewDialog } from '@/features/skill-version/SkillVersionPreviewDialog';
import { cn } from '@/lib/utils';
import { useSelectEffectiveVersion, type TimelineVersion, type VersionTimeline } from './use-capability-iteration';
import { skillVersionLabel } from './version-source';
import styles from './skill-detail.module.css';

export type DetailNavigation = (patch: Record<string, string | null>) => void;

export function VersionTimelinePanel({ timeline, releaseId, sourceFilter, onNavigate }: {
  timeline: VersionTimeline;
  releaseId?: string | null;
  sourceFilter?: string | null;
  onNavigate?: DetailNavigation;
}) {
  const [localSource, setSource] = useState('ALL');
  const source = onNavigate ? (sourceFilter === 'ENTERPRISE' || sourceFilter === 'PLATFORM' ? sourceFilter : 'ALL') : localSource;
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<TimelineVersion | null>(null);
  const selectVersion = useSelectEffectiveVersion(timeline.capability.id);
  const currentId = timeline.effectiveVersion?.id ?? timeline.currentVersionId;
  const releases = timeline.versions.filter(isPublishedVersion).sort((a, b) =>
    Number(b.id === currentId) - Number(a.id === currentId)
    || new Date(b.enterpriseReviewedAt ?? b.createdAt).getTime() - new Date(a.enterpriseReviewedAt ?? a.createdAt).getTime()
    || a.id.localeCompare(b.id));
  const visible = releases.filter((version) => source === 'ALL' || version.scope === source);
  const openId = onNavigate ? releaseId : previewId;
  const selectedRelease = releases.find((version) => version.id === openId);
  const closePreview = () => { setPreviewId(null); onNavigate?.({ release: null }); };
  const enable = () => {
    if (!candidate || !timeline.canManage || selectVersion.isPending) return;
    // Polling may remove a release or make it current while confirmation is open.
    if (!releases.some((version) => version.id === candidate.id) || candidate.id === currentId) {
      setCandidate(null);
      return;
    }
    selectVersion.mutate({ versionId: candidate.id }, {
      onSuccess: () => { toast.success(`已启用 ${skillVersionLabel(candidate)}`); setCandidate(null); },
      onError: (error) => toast.error(error.message || '启用失败'),
    });
  };

  return (
    <section aria-label="发布版本" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-gtext-muted">来源
          <select aria-label="版本来源" value={source} onChange={(event) => {
            setSource(event.target.value); onNavigate?.({ source: event.target.value === 'ALL' ? null : event.target.value });
          }}
            className={styles.select}>
            <option value="ALL">全部</option><option value="ENTERPRISE">企业</option><option value="PLATFORM">平台</option>
          </select>
        </label>
        <span className="text-xs tabular-nums text-gtext-muted">共 {visible.length} 个版本</span>
      </div>
      <div className={`${styles.tableHeading} hidden grid-cols-[170px_minmax(0,1fr)_145px_95px_190px] gap-4 lg:grid`} aria-hidden>
        <span>版本</span><span>更新说明</span><span>发布 / 创建时间</span><span>状态</span><span className="text-right">操作</span>
      </div>
      {!visible.length && <p className="py-12 text-center text-sm text-gtext-muted">{releases.length ? '暂无此来源的发布版本' : '暂无发布版本'}</p>}
      <ol className={styles.rows}>
        {visible.map((version) => {
          const current = version.id === currentId;
          return <li key={version.id} data-release-id={version.id}
            className={cn(styles.row, 'grid min-w-0 gap-4 lg:grid-cols-[170px_minmax(0,1fr)_145px_95px_190px] lg:items-center', current && styles.currentRow)}>
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gtext-primary">
              <span className={cn(styles.versionIcon, version.scope === 'ENTERPRISE' && styles.enterpriseIcon)}>{version.scope === 'ENTERPRISE' ? <Building2 className="h-4 w-4" /> : <Layers3 className="h-4 w-4" />}</span>
              {skillVersionLabel(version)}
              <span className={cn(styles.status, styles.mobileStatus, current && styles.positive, 'font-normal')}>{current ? '当前启用' : '可启用'}</span>
            </div>
            <p className="min-w-0 break-words text-xs leading-5 text-gtext-secondary">{version.changeSummary || '未填写更新说明'}</p>
            <div className="text-[11px] leading-5 text-gtext-muted"><span className="block">{version.enterpriseReviewedAt ? '发布时间' : '创建时间'}</span>
              <time>{formatDate(version.enterpriseReviewedAt ?? version.createdAt)}</time></div>
            <span className={cn(styles.status, styles.desktopStatus, current && styles.positive)}>{current && <span className="h-1.5 w-1.5 rounded-full bg-gsuccess" />}{current ? '当前启用' : '可启用'}</span>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Button size="sm" variant="glass" className={styles.action} onClick={() => {
                setPreviewId(version.id); onNavigate?.({ release: version.id });
              }}><FileText className="h-3.5 w-3.5" />查看详情</Button>
              {timeline.canManage && !current && <Button size="sm" variant="glass" className={cn(styles.action, styles.enable)}
                disabled={selectVersion.isPending} onClick={() => setCandidate(version)}><Check className="h-3.5 w-3.5" />启用</Button>}
              {version.sourceSubmissionId && <Link className={`${styles.sourceLink} inline-flex items-center gap-1 text-xs transition-colors`}
                href={`/capabilities/${timeline.capability.id}?tab=changes&submission=${encodeURIComponent(version.sourceSubmissionId)}`}
                onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate({ tab: 'changes', submission: version.sourceSubmissionId!, release: null }); } : undefined}>
                来源提交<ArrowUpRight className="h-3 w-3" />
              </Link>}
            </div>
          </li>;
        })}
      </ol>
      {openId && !selectedRelease && <p role="status" className="text-sm text-gtext-muted">该发布版本不存在或当前不可查看</p>}
      {selectedRelease && <SkillVersionPreviewDialog key={selectedRelease.id} versionId={selectedRelease.id} source="enterprise" open onOpenChange={(open) => { if (!open) closePreview(); }}
        details={<div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gtext-muted">
          <span>{selectedRelease.enterpriseReviewedAt ? '发布时间' : '创建时间'}：{formatDate(selectedRelease.enterpriseReviewedAt ?? selectedRelease.createdAt)}</span>
          {selectedRelease.sourceSubmissionId && <Link className="inline-flex items-center gap-1 text-gbrand-text hover:underline"
            href={`/capabilities/${timeline.capability.id}?tab=changes&submission=${encodeURIComponent(selectedRelease.sourceSubmissionId)}`}
            onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate({ tab: 'changes', submission: selectedRelease.sourceSubmissionId!, release: null }); } : undefined}>
            来源提交<ArrowUpRight className="h-3 w-3" /></Link>}
        </div>} />}
      <Dialog open={Boolean(candidate)} onOpenChange={(open) => { if (!open && !selectVersion.isPending) setCandidate(null); }}>
        <DialogContent glass className="w-[calc(100%-24px)]" onEscapeKeyDown={(event) => { if (selectVersion.isPending) event.preventDefault(); }} onInteractOutside={(event) => { if (selectVersion.isPending) event.preventDefault(); }}>
          <DialogHeader><DialogTitle className="tracking-normal">确认启用 {candidate && skillVersionLabel(candidate)}？</DialogTitle>
            <DialogDescription>将切换本企业所有相关员工的技能执行版本。历史发布版本和审核结果保持不变。</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="glass" disabled={selectVersion.isPending} onClick={() => setCandidate(null)}>取消</Button>
            <Button variant="glass-primary" disabled={selectVersion.isPending || candidate?.id === currentId} onClick={enable}><Check className="h-4 w-4" />{selectVersion.isPending ? '启用中...' : '确认启用'}</Button></div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function isPublishedVersion(version: TimelineVersion) {
  return (version.scope === 'PLATFORM' && version.status === 'PLATFORM_APPROVED')
    || (version.scope === 'ENTERPRISE' && version.status === 'ENTERPRISE_APPROVED');
}

export function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
