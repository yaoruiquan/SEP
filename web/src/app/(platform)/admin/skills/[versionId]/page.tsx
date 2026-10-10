'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Inbox, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { Markdown } from '@/features/chat/markdown';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import { useMonitorDetail, useMonitorReview, useSelectSkillSource, useSubmitMonitorReview } from '../use-skill-monitor';
import { VERSION_TYPE_LABELS, canSelectSource, creationMethodLabel, currentUsageLabel, enterpriseReviewLabel, platformProcessingLabel, promotedVersion } from '../monitor';
import { EnterprisePublishedVersions, VersionAttribution } from '../version-attribution';

export default function AdminSkillVersionDetailPage() {
  const { versionId = '' } = useParams<{ versionId: string }>();
  const router = useRouter();
  const query = useMonitorDetail(versionId);
  const review = useMonitorReview();
  const adopt = useSelectSkillSource();
  const submitReview = useSubmitMonitorReview();
  const [reason, setReason] = useState('');
  const [adoptNote, setAdoptNote] = useState('');
  const [tab, setTab] = useState('rendered');

  if (query.isLoading) return <CenteredSpinner label="加载审核详情..." />;
  if (query.isError) return <div role="alert" className="space-y-3 p-6 text-sm text-gdanger">加载失败：{query.error instanceof Error ? query.error.message : '请稍后重试'}<Button variant="glass" onClick={() => void query.refetch()}>重试</Button></div>;
  if (!query.data) return <div className="p-6 text-sm text-gdanger">技能版本不存在。</div>;
  const version = query.data;
  const status = SKILL_VERSION_STATUS[version.status];
  const pending = version.scope === 'PLATFORM' && version.status === 'PENDING_PLATFORM_REVIEW';
  const promoted = promotedVersion(version);
  const adoptable = canSelectSource(version);

  const decide = (decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'REJECT' && !reason.trim()) {
      toast.error('驳回时必须填写原因');
      return;
    }
    review.mutate(
      { id: versionId, decision, comment: reason.trim() || undefined, expectedUpdatedAt: version.updatedAt },
      {
        onSuccess: () => {
          toast.success(decision === 'APPROVE' ? '所选平台版本审核通过，已发布'  : '版本已驳回');
          router.push('/admin/skills');
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : '审核失败'),
      },
    );
  };

  const runAdopt = () => {
    adopt.mutate(
      { id: versionId, changeSummary: adoptNote.trim() || undefined, expectedUpdatedAt: version.updatedAt },
      {
        onSuccess: (created) => {
          toast.success(`已收录为平台待审版本 v${created.version}`);
          router.push(`/admin/skills/${created.id}`);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : '采纳失败'),
      },
    );
  };

  return (
    <div className="w-full min-w-0 space-y-5 p-6">
      <button
        onClick={() => router.push('/admin/skills')}
        className="inline-flex items-center gap-2 text-sm text-gtext-secondary hover:text-gtext-primary"
      >
        <ArrowLeft className="h-4 w-4" /> 返回技能监控
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-semibold text-gtext-primary">{version.capability.name}</h1>
            {!version.parentVersionId && !version.sourceVersionId && (
              <Badge variant="glass-info">原始版本</Badge>
            )}
            <Badge className={status.className}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-gtext-muted">
            版本 v{version.version} · {VERSION_TYPE_LABELS[version.scope]}
            {version.enterprise ? ` · 来源企业：${version.enterprise.name}` : ''}
          </p>
        </div>
      </header>
      <section aria-label="版本分类" className="grid gap-3 border-y border-glassline py-4 text-sm text-gtext-secondary sm:grid-cols-3"><p>版本类型：{VERSION_TYPE_LABELS[version.scope]}<br />产生方式：{creationMethodLabel(version)}</p><p>企业审核：{enterpriseReviewLabel(version)}<br />平台处理：{platformProcessingLabel(version)}</p><p>当前使用：{currentUsageLabel(version)}</p></section>
      <section aria-label="版本归属" className="grid min-w-0 gap-4 border-b border-glassline pb-4 sm:grid-cols-3">
        <VersionAttribution version={version} />
        <div><h2 className="mb-2 text-xs text-gtext-muted">对应企业版本</h2><EnterprisePublishedVersions version={version} /></div>
        <div className="min-w-0 break-all text-xs text-gtext-muted"><p>技能 ID：{version.capabilityId}</p><p className="mt-2">版本 ID：{version.id}</p></div>
      </section>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="只读正文" className="min-h-[70vh] min-w-0">
          <Tabs value={tab} onValueChange={setTab} className="min-w-0">
            <TabsList className="bg-glass-1">
              <TabsTrigger value="rendered">渲染视图</TabsTrigger>
              <TabsTrigger value="source">Markdown</TabsTrigger>
            </TabsList>
            <TabsContent value="rendered" className="mt-4 min-w-0">
              <Markdown content={version.content} />
            </TabsContent>
            <TabsContent value="source" className="mt-4 min-w-0">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gtext-secondary">
                {version.content}
              </pre>
            </TabsContent>
          </Tabs>
        </section>
        <aside className="min-w-0 space-y-4">
          <Card className="p-5">
            <h2 className="font-medium text-gtext-primary">版本信息</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-gtext-muted">变更说明</dt>
                <dd className="mt-1 text-gtext-secondary">
                  {version.changeSummary ||
                    (!version.parentVersionId && !version.sourceVersionId ? '原始正文' : '未填写')}
                </dd>
              </div>
              {version.parentVersionId && (
                <div>
                  <dt className="text-gtext-muted">版本关系</dt>
                  <dd className="mt-1 text-gtext-secondary">
                    基于父版本派生，需核对本次变更说明与正文是否一致。
                  </dd>
                </div>
              )}
              {version.sourceVersion && <div><dt className="text-gtext-muted">原始来源版本</dt><dd className="mt-1 break-all"><Link href={`/admin/skills/${version.sourceVersion.id}`} className="text-gbrand-text hover:underline">{VERSION_TYPE_LABELS[version.sourceVersion.scope]} v{version.sourceVersion.version}</Link><p className="mt-1 text-xs text-gtext-muted">技能 ID：{version.sourceVersion.capabilityId}</p><p className="mt-1 text-xs text-gtext-muted">版本 ID：{version.sourceVersion.id}</p></dd></div>}
              <div><dt className="text-gtext-muted">包信息</dt><dd className="mt-1 break-all text-gtext-secondary">{version.packageKey ? <><p>{version.packageFilename || version.packageKey}</p><p>文件数：{version.packageFileCount ?? '未标注'}</p><p className="mt-1 font-mono text-xs">SHA256：{version.packageSha256 || '未标注'}</p></> : '无包记录'}</dd></div>
              {version.enterpriseDefaultCount !== undefined && <div><dt className="text-gtext-muted">启用与市场绑定</dt><dd className="mt-1 text-gtext-secondary">企业启用：{version.enterpriseDefaultCount} 家<br />版本绑定：{version.defaultBindingCount ?? 0} 个<br />市场员工绑定：{version.marketBindingCount ?? 0} 个</dd></div>}
              {version.rejectionReason && <div><dt className="text-gtext-muted">驳回原因</dt><dd className="mt-1 break-words text-gdanger">{version.rejectionReason}</dd></div>}
              <div>
                <dt className="text-gtext-muted">更新时间</dt>
                <dd className="mt-1 text-gtext-secondary">
                  {new Date(version.updatedAt).toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>
          </Card>
          {Boolean(version.reviews?.length) && <section aria-label="审核历史" className="border-y border-glassline py-4"><h2 className="font-medium text-gtext-primary">审核历史</h2><ol className="mt-3 space-y-4 text-sm text-gtext-secondary">{version.reviews?.map((entry) => <li key={entry.id}><p>{entry.actorType === 'PLATFORM' ? '平台' : '企业'} · {entry.decision === 'APPROVE' ? '通过' : '驳回'} · {entry.reviewer.name || entry.reviewer.id}</p><p className="mt-1 text-xs text-gtext-muted">{new Date(entry.createdAt).toLocaleString('zh-CN')}</p>{entry.comment && <p className="mt-1 whitespace-pre-wrap break-words">{entry.comment}</p>}</li>)}</ol></section>}

          {version.scope === 'PLATFORM' && ['DRAFT', 'PLATFORM_REJECTED'].includes(version.status) && <section className="border-y border-glassline py-4"><Button className="w-full" variant="glass-primary" loading={submitReview.isPending} onClick={() => submitReview.mutate({ id: versionId, expectedUpdatedAt: version.updatedAt }, { onSuccess: () => toast.success('该版本已重新进入平台待审'), onError: (error) => toast.error(error instanceof Error ? error.message : '送审失败') })}><Inbox className="h-4 w-4" />提交平台审核</Button></section>}

          {promoted && (
            <Card className="p-5">
              <h2 className="font-medium text-gtext-primary">已收录</h2>
              <p className="mt-2 text-sm text-gtext-secondary">
                平台版 v{promoted.version} · {SKILL_VERSION_STATUS[promoted.status].label}
              </p>
              <Link
                href={`/admin/skills/${promoted.id}`}
                className="mt-3 inline-block text-sm text-gbrand-text hover:underline"
              >
                查看平台版本 →
              </Link>
            </Card>
          )}

          {adoptable && (
            <Card className="p-5">
              <h2 className="font-medium text-gtext-primary">选择来源进入平台审核</h2>
              <textarea
                value={adoptNote}
                onChange={(event) => setAdoptNote(event.target.value)}
                rows={4}
                placeholder="变更说明（可留空，默认写「平台采纳 XX 的 vN」）"
                className="mt-3 w-full resize-none rounded-md border border-glassline bg-glass-1 p-3 text-sm text-gtext-primary focus:outline-none focus:ring-2 focus:ring-gbrand-ring"
              />
              <div className="mt-3 space-y-2">
                <Button
                  variant="glass"
                  className="w-full"
                  onClick={runAdopt}
                  loading={adopt.isPending}
                >
                  <Inbox className="h-4 w-4" /> 收录到平台待审
                </Button>

              </div>
            </Card>
          )}

          {pending && (
            <Card className="p-5">
              <h2 className="font-medium text-gtext-primary">审核并发布所选平台版本</h2>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={5}
                placeholder="驳回时必须填写原因"
                className="mt-4 w-full resize-none rounded-md border border-glassline bg-glass-1 p-3 text-sm text-gtext-primary focus:outline-none focus:ring-2 focus:ring-gbrand-ring"
              />
              <div className="mt-3 grid gap-2">
                <Button variant="glass" onClick={() => decide('REJECT')} loading={review.isPending}>
                  <X className="h-4 w-4" /> 驳回
                </Button>
                <Button
                  variant="glass-primary"
                  onClick={() => decide('APPROVE')}
                  loading={review.isPending}
                >
                  <Check className="h-4 w-4" /> 审核通过并发布
                </Button>
              </div>
            </Card>
          )}
        </aside>
      </div>

    </div>
  );
}
