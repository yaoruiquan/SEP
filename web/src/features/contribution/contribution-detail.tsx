'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Award,
  Bot,
  BriefcaseBusiness,
  Check,
  CircleDashed,
  Clock3,
  ExternalLink,
  Eye,
  FileCode2,
  GitBranch,
  LockKeyhole,
  Layers3,
  Send,
  Store,
  Trophy,
  UsersRound,
  UserRound,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import type { ContributionCapability, ContributionCapabilityDetail } from '@/lib/types';
import { PLATFORM_META, REVIEW_META, TYPE_META, currentContributionState, toneClasses } from './contribution-status';
import { useContribution, useContributionAction, useContributionUsage, useReviewContribution } from './use-contributions';
import { SkillVersionPreviewDialog } from '@/features/skill-version/SkillVersionPreviewDialog';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';

export function ContributionDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useContribution(id);
  if (query.isLoading) return <CenteredSpinner label="加载能力详情..." />;
  if (query.isError || !query.data) return <EmptyState title="详情加载失败" description="请稍后重试，或重新选择一个能力。" />;
  return <ContributionDetailContent contribution={query.data} onBack={onBack} />;
}

type DetailView = 'pipeline' | 'versions' | 'usage' | 'profile' | 'rewards';

function ContributionDetailContent({ contribution, onBack }: { contribution: ContributionCapabilityDetail; onBack: () => void }) {
  const [view, setView] = useState<DetailView>('pipeline');
  const [previewVersionId, setPreviewVersionId] = useState('');
  const usage = useContributionUsage(contribution.id);
  const isEnterpriseAdmin = useAuthStore((s) => s.roleInEnterprise) === 'ENTERPRISE_ADMIN';
  const hasEnterprise = Boolean(useAuthStore((s) => s.enterprise));
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isContributor = currentUserId === contribution.contributor.id;
  const submitEnterprise = useContributionAction('submit-enterprise-review');
  const requestPlatform = useContributionAction('request-platform-review');
  const authorizePlatform = useContributionAction('authorize-platform-submission');
  const enterpriseReview = useReviewContribution('enterprise');
  const state = currentContributionState(contribution);
  const loading = submitEnterprise.isPending || requestPlatform.isPending || authorizePlatform.isPending || enterpriseReview.isPending;

  const mutate = (fn: { mutate: (id: string, options: { onSuccess: () => void; onError: (error: unknown) => void }) => void }, message: string) => {
    fn.mutate(contribution.id, { onSuccess: () => toast.success(message), onError: (error) => toast.error(error instanceof Error ? error.message : '操作失败') });
  };
  const decide = (decision: 'APPROVE' | 'REJECT') => {
    const comment = decision === 'REJECT' ? window.prompt('请输入驳回原因')?.trim() : undefined;
    if (decision === 'REJECT' && !comment) return;
    enterpriseReview.mutate({ id: contribution.id, decision, comment }, { onSuccess: () => toast.success(decision === 'APPROVE' ? '企业审核已通过' : '企业审核已驳回'), onError: (error) => toast.error(error instanceof Error ? error.message : '审核失败') });
  };

  return <div className="flex h-full min-h-0 flex-col bg-gbg-canvas">
    <header className="shrink-0 border-b border-glassline px-6 py-5 xl:px-10">
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-xs text-gtext-muted transition-colors hover:text-gtext-primary"><ArrowLeft className="h-3.5 w-3.5" />返回能力资产总览</button>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><TypeBadge item={contribution} /><Badge className={cn('border', toneClasses[state.tone])}>{state.label}</Badge><span className="text-xs text-gtext-muted">更新于 {new Date(contribution.updatedAt).toLocaleDateString('zh-CN')}</span></div><h2 className="mt-2 truncate text-2xl font-semibold text-gtext-primary">{contribution.name}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-gtext-secondary">{contribution.description}</p></div>
        <ActionBar contribution={contribution} hasEnterprise={hasEnterprise} isContributor={isContributor} isEnterpriseAdmin={isEnterpriseAdmin} loading={loading} onSubmitEnterprise={() => mutate(submitEnterprise, '已提交企业审核')} onApprove={() => decide('APPROVE')} onReject={() => decide('REJECT')} onRequestPlatform={() => mutate(requestPlatform, '已申请公开投稿，等待企业管理员授权')} onAuthorizePlatform={() => mutate(authorizePlatform, '已授权提交平台审核')} />
      </div>
      <nav aria-label="能力详情视图" className="mt-6 flex gap-6 border-b border-glassline"><DetailTab active={view === 'pipeline'} onClick={() => setView('pipeline')}>发布流程</DetailTab>{contribution.type === 'SKILL' && <DetailTab active={view === 'versions'} onClick={() => setView('versions')}>版本迭代</DetailTab>}<DetailTab active={view === 'usage'} onClick={() => setView('usage')}>使用情况</DetailTab><DetailTab active={view === 'profile'} onClick={() => setView('profile')}>能力档案</DetailTab><DetailTab active={view === 'rewards'} onClick={() => setView('rewards')}>贡献奖励</DetailTab></nav>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto scroll-thin px-6 py-7 xl:px-10"><div className="mx-auto max-w-5xl">
      {view === 'pipeline' && <PipelineView contribution={contribution} hasEnterprise={hasEnterprise} />}
      {view === 'versions' && <VersionView contribution={contribution} onPreview={setPreviewVersionId} />}
      {view === 'usage' && <UsageView query={usage} />}
      {view === 'profile' && <ProfileView contribution={contribution} />}
      {view === 'rewards' && <RewardsView contribution={contribution} />}
    </div></main>
    <SkillVersionPreviewDialog versionId={previewVersionId} open={Boolean(previewVersionId)} onOpenChange={(open) => !open && setPreviewVersionId('')} />
  </div>;
}

function DetailTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={cn('relative pb-3 text-sm transition-colors', active ? 'font-semibold text-gtext-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-gbrand' : 'text-gtext-muted hover:text-gtext-secondary')}>{children}</button>; }

function PipelineView({ contribution, hasEnterprise }: { contribution: ContributionCapabilityDetail; hasEnterprise: boolean }) { return <section><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-gbrand-text">Release pipeline</p><h3 className="mt-1 text-lg font-semibold text-gtext-primary">发布流程</h3><p className="mt-1 text-sm text-gtext-secondary">每个节点独立推进，完成记录会自动留存。</p></div><span className="text-sm text-gtext-muted">{pipelineProgress(contribution)}% 已完成</span></div><div className="mt-5 h-1.5 bg-glass-3"><span className="block h-full bg-gbrand transition-all" style={{ width: `${pipelineProgress(contribution)}%` }} /></div><Pipeline contribution={contribution} hasEnterprise={hasEnterprise} /><div className="mt-8 border-t border-glassline pt-6"><div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-gbrand-text" /><h3 className="text-sm font-semibold text-gtext-primary">当前执行者</h3></div><WorkerStrip contribution={contribution} /></div></section>; }

function ProfileView({ contribution }: { contribution: ContributionCapabilityDetail }) { const version = contribution.skillVersions[0]; return <section className="max-w-3xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-gbrand-text">Capability profile</p><h3 className="mt-1 text-lg font-semibold text-gtext-primary">能力档案</h3><p className="mt-1 text-sm text-gtext-secondary">能力的归属、版本和可见范围。</p><div className="mt-6 divide-y divide-glassline border-y border-glassline"><ProfileRow label="贡献者" value={contribution.contributor.name || contribution.contributor.email} /><ProfileRow label="归属工作区" value={contribution.enterprise?.name || '个人贡献'} /><ProfileRow label="当前版本" value={version ? `v${version.version}` : '暂无版本'} /><ProfileRow label="可见范围" value={contribution.visibility === 'MARKET_PUBLIC' ? '硅基人才市场' : '企业私有'} /><ProfileRow label="累计调用" value={`${contribution.usageCount} 次`} /><ProfileRow label="绑定员工" value={`${contribution._count.bindings} 个`} /></div></section>; }

function ProfileRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-6 py-4 text-sm"><span className="text-gtext-muted">{label}</span><span className="font-medium text-gtext-primary">{value}</span></div>; }

function RewardsView({ contribution }: { contribution: ContributionCapabilityDetail }) { const points = contribution.contributionRewards.reduce((sum, item) => sum + item.points, 0); return <section className="max-w-3xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-gbrand-text">Contribution reward</p><h3 className="mt-1 text-lg font-semibold text-gtext-primary">贡献奖励</h3><p className="mt-1 text-sm text-gtext-secondary">奖励将在审核与市场采用节点达成后持续累积。</p><div className="mt-6 flex items-end justify-between border-l-2 border-gwarning bg-gwarning/10 px-5 py-6"><div><p className="text-4xl font-semibold text-gtext-primary">{points}</p><p className="mt-2 text-sm text-gtext-muted">累计待确认积分</p></div><Trophy className="h-7 w-7 text-gwarning" /></div><div className="mt-6 divide-y divide-glassline border-y border-glassline">{contribution.contributionRewards.length ? contribution.contributionRewards.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 py-4"><div><p className="text-sm font-medium text-gtext-primary">{item.eventType}</p><p className="mt-1 text-xs text-gtext-muted">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</p></div><span className="font-semibold text-gsuccess">+{item.points} 积分</span></div>) : <div className="flex items-center gap-2 py-6 text-sm text-gtext-muted"><LockKeyhole className="h-4 w-4" />审核通过后记录奖励事件</div>}</div></section>; }

function VersionView({ contribution, onPreview }: { contribution: ContributionCapabilityDetail; onPreview: (id: string) => void }) {
  const versions = contribution.skillVersions;
  return <section className="max-w-4xl"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-gbrand-text">Skill versions</p><h3 className="mt-1 text-lg font-semibold text-gtext-primary">版本迭代</h3><p className="mt-1 text-sm text-gtext-secondary">在这里查看 Skill 的版本路线、审核状态和正文。</p></div><span className="text-sm text-gtext-muted">{versions.length} 个版本</span></div>{versions.length ? <div className="mt-6 space-y-3">{versions.map((version, index) => { const meta = SKILL_VERSION_STATUS[version.status]; const latest = index === 0; const editable = version.status === 'DRAFT' || version.status === 'ENTERPRISE_REJECTED'; return <article key={version.id} className={cn('relative border p-4', latest ? 'border-glassline-brand bg-glass-accent-2' : 'border-glassline bg-glass-1')}><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-gtext-primary">v{version.version}</span>{latest && <Badge className="border border-glassline-brand bg-gbrand/15 text-gbrand-text">最新</Badge>}{!version.parentVersionId && !version.sourceVersionId && <Badge variant="glass-info">原始版本</Badge>}<Badge className={meta.className}>{meta.label}</Badge></div><p className="mt-2 text-sm text-gtext-secondary">{version.changeSummary || (!version.parentVersionId && !version.sourceVersionId ? '技能原始正文，后续版本从此版本派生。' : '未填写变更说明。')}</p><p className="mt-2 text-xs text-gtext-muted">{version.scope === 'PLATFORM' ? '平台版本' : '企业版本'} · 更新于 {new Date(version.updatedAt).toLocaleDateString('zh-CN')}</p></div><div className="flex shrink-0 flex-wrap gap-2"><Button variant="glass" size="sm" onClick={() => onPreview(version.id)}><Eye className="h-4 w-4" />预览</Button>{editable && <Link href={`/skills/${version.id}/edit`} className="inline-flex h-8 items-center gap-2 rounded-md border border-glassline bg-glass-2 px-3 text-sm font-medium text-gtext-primary transition-colors hover:bg-glass-3"><FileCode2 className="h-4 w-4" />编辑</Link>}</div></div></article>; })}</div> : <div className="mt-6 border border-dashed border-glassline px-5 py-10 text-center text-sm text-gtext-muted">还没有 Skill 版本</div>}</section>;
}

function UsageView({ query }: { query: ReturnType<typeof useContributionUsage> }) {
  if (query.isLoading) return <div className="flex min-h-56 items-center justify-center text-sm text-gtext-muted">正在读取能力使用情况...</div>;
  if (query.isError || !query.data) return <div className="border border-dashed border-glassline px-5 py-10 text-center text-sm text-gdanger">使用情况暂时无法加载，请稍后重试。</div>;
  const { employees } = query.data;
  return <section className="max-w-5xl"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-gbrand-text">Runtime adoption</p><h3 className="mt-1 text-lg font-semibold text-gtext-primary">使用情况</h3><p className="mt-1 text-sm text-gtext-secondary">查看哪些硅基员工正在使用这项能力，以及实际生效的版本。</p></div><span className="text-sm text-gtext-muted">{query.data.totalBindings} 个员工</span></div>{employees.length ? <div className="mt-6 divide-y divide-glassline border-y border-glassline">{employees.map((employee) => <div key={employee.employeeId} className="grid gap-3 py-4 md:grid-cols-[minmax(180px,1fr)_170px_150px_120px] md:items-center"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center border border-glassline bg-glass-1 text-gbrand-text"><UsersRound className="h-4 w-4" /></span><div><p className="text-sm font-medium text-gtext-primary">{employee.employeeName}</p><p className="mt-1 text-xs text-gtext-muted">{employee.usageCount} 次能力调用</p></div></div><VersionCell label="选定版本" version={employee.selectedVersion?.version ? `v${employee.selectedVersion.version}` : '跟随默认'} /><VersionCell label="实际生效" version={employee.effectiveVersion?.version ? `v${employee.effectiveVersion.version}` : '暂无可用版本'} /><div className="text-left md:text-right"><p className="text-xs text-gtext-muted">最近使用</p><p className="mt-1 text-xs text-gtext-secondary">{employee.lastUsedAt ? new Date(employee.lastUsedAt).toLocaleDateString('zh-CN') : '尚未使用'}</p></div></div>)}</div> : <div className="mt-6 border border-dashed border-glassline px-5 py-12 text-center"><UsersRound className="mx-auto h-6 w-6 text-gtext-muted" /><p className="mt-3 text-sm font-medium text-gtext-primary">尚未被硅基员工使用</p><p className="mt-1 text-xs text-gtext-muted">能力通过审核并绑定到员工后，会在这里看到运行情况。</p></div>}</section>;
}

function VersionCell({ label, version }: { label: string; version: string }) { return <div><p className="text-xs text-gtext-muted">{label}</p><p className="mt-1 text-sm font-medium text-gtext-primary">{version}</p></div>; }

function ActionBar({ contribution, hasEnterprise, isContributor, isEnterpriseAdmin, loading, onSubmitEnterprise, onApprove, onReject, onRequestPlatform, onAuthorizePlatform }: { contribution: ContributionCapability; hasEnterprise: boolean; isContributor: boolean; isEnterpriseAdmin: boolean; loading: boolean; onSubmitEnterprise: () => void; onApprove: () => void; onReject: () => void; onRequestPlatform: () => void; onAuthorizePlatform: () => void }) {
  return <div className="flex shrink-0 flex-wrap gap-2">
    {!hasEnterprise && isContributor && ['NOT_SUBMITTED', 'REJECTED'].includes(contribution.platformReviewStatus) && <Button variant="glass-primary" size="sm" loading={loading} onClick={onRequestPlatform}><Send className="h-4 w-4" />提交平台审核</Button>}
    {hasEnterprise && isContributor && contribution.enterpriseReviewStatus === 'NOT_SUBMITTED' && <Button variant="glass-primary" size="sm" loading={loading} onClick={onSubmitEnterprise}><Send className="h-4 w-4" />提交企业审核</Button>}
    {isEnterpriseAdmin && contribution.enterpriseReviewStatus === 'PENDING' && <><Button variant="glass-primary" size="sm" loading={loading} onClick={onApprove}><Check className="h-4 w-4" />企业通过</Button><Button variant="glass" size="sm" loading={loading} onClick={onReject}><X className="h-4 w-4" />驳回</Button></>}
    {isContributor && contribution.enterpriseReviewStatus === 'APPROVED' && contribution.platformReviewStatus === 'NOT_SUBMITTED' && <Button variant="glass" size="sm" loading={loading} onClick={onRequestPlatform}><ExternalLink className="h-4 w-4" />申请公开投稿</Button>}
    {isEnterpriseAdmin && contribution.platformReviewStatus === 'REQUESTED' && <Button variant="glass-primary" size="sm" loading={loading} onClick={onAuthorizePlatform}><Store className="h-4 w-4" />授权平台审核</Button>}
  </div>;
}

type PipelineStep = { title: string; desc: string; state: 'done' | 'active' | 'waiting' | 'blocked'; time?: string | null };

function Pipeline({ contribution, hasEnterprise }: { contribution: ContributionCapabilityDetail; hasEnterprise: boolean }) {
  const enterprise = REVIEW_META[contribution.enterpriseReviewStatus];
  const platform = PLATFORM_META[contribution.platformReviewStatus];
  const steps: PipelineStep[] = hasEnterprise ? [
    { title: '创建能力草稿', desc: contribution.enterprise?.name ? `归属 ${contribution.enterprise.name}` : '企业工作区草稿', state: 'done', time: contribution.skillVersions[0]?.createdAt },
    { title: '自动校验', desc: contribution.validatedAt ? '输入输出结构与安全边界已检查' : '等待系统校验', state: contribution.validatedAt ? 'done' : 'active', time: contribution.validatedAt },
    { title: '企业管理员审核', desc: contribution.enterpriseRejectionReason || enterprise.label, state: contribution.enterpriseReviewStatus === 'APPROVED' ? 'done' : contribution.enterpriseReviewStatus === 'PENDING' ? 'active' : contribution.enterpriseReviewStatus === 'REJECTED' ? 'blocked' : 'waiting', time: contribution.enterpriseReviewedAt },
    { title: '授权公开投稿', desc: contribution.platformReviewStatus === 'REQUESTED' ? '等待企业管理员授权' : platform.label, state: contribution.platformReviewStatus === 'REQUESTED' ? 'active' : ['PENDING_REVIEW', 'APPROVED'].includes(contribution.platformReviewStatus) ? 'done' : 'waiting', time: contribution.platformSubmittedAt },
    { title: '平台运营审核', desc: contribution.platformRejectionReason || platform.label, state: contribution.platformReviewStatus === 'APPROVED' ? 'done' : contribution.platformReviewStatus === 'PENDING_REVIEW' ? 'active' : contribution.platformReviewStatus === 'REJECTED' ? 'blocked' : 'waiting', time: contribution.platformSubmittedAt },
    { title: '上架硅基人才市场', desc: contribution.platformReviewStatus === 'APPROVED' ? '市场用户可以发现并使用' : '通过平台审核后开放', state: contribution.platformReviewStatus === 'APPROVED' ? 'done' : 'waiting' },
  ] : [
    { title: '创建个人草稿', desc: '能力归属于贡献者本人', state: 'done', time: contribution.skillVersions[0]?.createdAt },
    { title: '自动校验', desc: contribution.validatedAt ? '结构与安全边界已检查' : '等待系统校验', state: contribution.validatedAt ? 'done' : 'active', time: contribution.validatedAt },
    { title: '平台运营审核', desc: contribution.platformRejectionReason || platform.label, state: contribution.platformReviewStatus === 'APPROVED' ? 'done' : contribution.platformReviewStatus === 'PENDING_REVIEW' ? 'active' : contribution.platformReviewStatus === 'REJECTED' ? 'blocked' : 'waiting', time: contribution.platformSubmittedAt },
    { title: '上架硅基人才市场', desc: contribution.platformReviewStatus === 'APPROVED' ? '市场用户可以发现并使用' : '通过平台审核后开放', state: contribution.platformReviewStatus === 'APPROVED' ? 'done' : 'waiting' },
  ];
  return <div className="mt-5 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">{steps.map((step, index) => <PipelineCard key={step.title} step={step} index={index} total={steps.length} />)}</div>;
}

function PipelineCard({ step, index, total }: { step: PipelineStep; index: number; total: number }) {
  const tone = step.state === 'done' ? 'success' : step.state === 'active' ? 'warning' : step.state === 'blocked' ? 'danger' : 'muted';
  return <div className={cn('relative border p-4', step.state === 'active' ? 'border-gwarning/45 bg-gwarning/10' : step.state === 'done' ? 'border-gsuccess/25 bg-gsuccess/5' : 'border-glassline bg-glass-1')}>
    <div className="flex items-start gap-3"><span className={cn('grid h-7 w-7 shrink-0 place-items-center border text-xs font-semibold', toneClasses[tone])}>{step.state === 'done' ? <Check className="h-3.5 w-3.5" /> : step.state === 'active' ? <Clock3 className="h-3.5 w-3.5" /> : step.state === 'blocked' ? <X className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}</span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-gtext-primary">{step.title}</p><span className={cn('text-[11px]', tone === 'success' ? 'text-gsuccess' : tone === 'warning' ? 'text-gwarning' : tone === 'danger' ? 'text-gdanger' : 'text-gtext-muted')}>{step.state === 'done' ? '完成' : step.state === 'active' ? '进行中' : step.state === 'blocked' ? '需处理' : '等待'}</span></div><p className="mt-1 text-xs leading-5 text-gtext-muted">{step.desc}</p>{step.time && <p className="mt-2 text-[11px] text-gtext-muted">{new Date(step.time).toLocaleString('zh-CN')}</p>}</div></div>
    {index < total - 1 && <span className="absolute -right-2 top-7 z-10 hidden h-px w-2 bg-glassline 2xl:block" />}
  </div>;
}

function WorkerStrip({ contribution }: { contribution: ContributionCapabilityDetail }) {
  const active = currentContributionState(contribution).tone === 'warning';
  const isSkill = contribution.type === 'SKILL';
  return <div className="mt-3 flex items-center gap-4 border border-glassline bg-glass-1 p-4"><div className="relative grid h-11 w-11 shrink-0 place-items-center border border-glassline-brand bg-gbrand/15 text-gbrand-text"><Bot className="h-5 w-5" />{active && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse bg-gwarning ring-2 ring-gbg-canvas" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-gtext-primary">{isSkill ? 'Skill 审核员' : 'Agent 接入员'}</p><span className={cn('text-xs', active ? 'text-gwarning' : 'text-gsuccess')}>{active ? '正在工作' : '待命'}</span></div><p className="mt-1 truncate text-xs text-gtext-muted">{active ? '检查输入输出、版本内容与企业归属，完成后将自动推进下一节点' : '最近一次检查已完成，等待新的发布动作'}</p></div><div className="hidden items-center gap-1.5 text-xs text-gtext-muted sm:flex"><span className={cn('h-1.5 w-1.5', active ? 'bg-gwarning animate-pulse' : 'bg-gsuccess')} />LIVE</div></div>;
}

function ContextPanel({ contribution }: { contribution: ContributionCapabilityDetail }) {
  const points = contribution.contributionRewards.reduce((sum, item) => sum + item.points, 0);
  const version = contribution.skillVersions[0];
  return <div className="space-y-6"><section><p className="text-xs font-semibold uppercase tracking-[0.16em] text-gtext-muted">Ownership</p><div className="mt-3 space-y-0 border-y border-glassline"><InfoRow icon={UserRound} label="贡献者" value={contribution.contributor.name || contribution.contributor.email} /><InfoRow icon={BriefcaseBusiness} label="归属工作区" value={contribution.enterprise?.name || '个人贡献'} /><InfoRow icon={Layers3Icon} label="版本" value={version ? `v${version.version}` : '暂无版本'} /><InfoRow icon={Store} label="可见范围" value={contribution.visibility === 'MARKET_PUBLIC' ? '硅基人才市场' : '企业私有'} /></div></section><section><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-gtext-muted">Contribution reward</p><p className="mt-1 text-sm font-semibold text-gtext-primary">贡献奖励</p></div><Trophy className="h-5 w-5 text-gwarning" /></div><div className="mt-3 border border-gwarning/30 bg-gwarning/10 p-4"><p className="text-2xl font-semibold text-gtext-primary">{points}</p><p className="mt-1 text-xs text-gtext-muted">累计待确认积分</p></div><div className="mt-2 space-y-2">{contribution.contributionRewards.length ? contribution.contributionRewards.map((item) => <div key={item.id} className="flex items-center justify-between border-b border-glassline py-2 text-xs"><span className="flex items-center gap-2 text-gtext-secondary"><Award className="h-3.5 w-3.5 text-gwarning" />{item.eventType}</span><span className="font-semibold text-gsuccess">+{item.points}</span></div>) : <div className="flex items-center gap-2 py-2 text-xs text-gtext-muted"><LockKeyhole className="h-3.5 w-3.5" />审核通过后记录奖励事件</div>}</div></section><section className="border-t border-glassline pt-5"><div className="flex items-center justify-between text-xs"><span className="text-gtext-muted">累计调用</span><span className="font-semibold text-gtext-primary">{contribution.usageCount} 次</span></div><div className="mt-2 flex items-center justify-between text-xs"><span className="text-gtext-muted">绑定员工</span><span className="font-semibold text-gtext-primary">{contribution._count.bindings} 个</span></div></section></div>;
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return <div className="flex items-center gap-3 border-b border-glassline py-3 last:border-b-0"><Icon className="h-3.5 w-3.5 shrink-0 text-gtext-muted" /><span className="text-xs text-gtext-muted">{label}</span><span className="ml-auto max-w-[58%] truncate text-right text-xs font-medium text-gtext-primary">{value}</span></div>;
}

function TypeBadge({ item }: { item: ContributionCapability }) { return <Badge variant="glass-info">{TYPE_META[item.type].label}</Badge>; }
function Layers3Icon(props: React.ComponentProps<typeof Layers3>) { return <Layers3 {...props} />; }

function pipelineProgress(contribution: ContributionCapabilityDetail) {
  const total = contribution.enterprise ? 6 : 4;
  let done = contribution.validatedAt ? 2 : 1;
  if (contribution.enterprise && contribution.enterpriseReviewStatus === 'APPROVED') done += 1;
  if (!contribution.enterprise && contribution.platformReviewStatus === 'PENDING_REVIEW') done += 1;
  if (contribution.enterprise && ['PENDING_REVIEW', 'APPROVED'].includes(contribution.platformReviewStatus)) done += 1;
  if (contribution.platformReviewStatus === 'APPROVED') done = total;
  return Math.min(100, Math.round((done / total) * 100));
}
