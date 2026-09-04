'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Inbox, Rocket, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CenteredSpinner } from '@/components/ui/feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { Markdown } from '@/features/chat/markdown';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import {
  useAdoptEnterpriseSkillVersion,
  useReviewPlatformSkillVersion,
  useSkillVersionPreview,
} from '@/features/skill-version/use-skill-version';

export default function AdminSkillVersionDetailPage() {
  const { versionId = '' } = useParams<{ versionId: string }>();
  const router = useRouter();
  const query = useSkillVersionPreview(versionId, 'admin');
  const review = useReviewPlatformSkillVersion();
  const adopt = useAdoptEnterpriseSkillVersion();
  const [reason, setReason] = useState('');
  const [adoptNote, setAdoptNote] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [tab, setTab] = useState('rendered');

  if (query.isLoading) return <CenteredSpinner label="加载审核详情..." />;
  if (!query.data) return <div className="p-6 text-sm text-gdanger">技能版本不存在。</div>;
  const version = query.data;
  const status = SKILL_VERSION_STATUS[version.status];
  const pending = version.status === 'PENDING_PLATFORM_REVIEW';
  // 企业版本可以被平台主动采纳。sourceVersionId 是唯一索引，所以 promotedVersions
  // 最多一条 —— 有值就说明这一版已经投过稿或被采纳过，不该再给一个可点的按钮。
  const promoted = version.promotedVersions?.[0];
  const adoptable = version.scope === 'ENTERPRISE' && version.status !== 'ARCHIVED' && !promoted;

  const decide = (decision: 'APPROVE' | 'REJECT') => {
    if (decision === 'REJECT' && !reason.trim()) {
      toast.error('驳回时必须填写原因');
      return;
    }
    review.mutate(
      { id: versionId, decision, comment: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(decision === 'APPROVE' ? '平台审核已通过' : '版本已驳回');
          router.push('/admin/skills');
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : '审核失败'),
      },
    );
  };

  const runAdopt = (mode: 'DRAFT' | 'PUBLISH') => {
    adopt.mutate(
      { id: versionId, mode, changeSummary: adoptNote.trim() || undefined },
      {
        onSuccess: (created) => {
          toast.success(
            mode === 'PUBLISH'
              ? `已发布为平台版 v${created.version}`
              : `已收为待审草稿 v${created.version}`,
          );
          router.push(`/admin/skills/${created.id}`);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : '采纳失败'),
      },
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <button
        onClick={() => router.push('/admin/skills')}
        className="inline-flex items-center gap-2 text-sm text-gtext-secondary hover:text-gtext-primary"
      >
        <ArrowLeft className="h-4 w-4" /> 返回技能版本
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-gtext-primary">{version.capability.name}</h1>
            {!version.parentVersionId && !version.sourceVersionId && (
              <Badge variant="glass-info">原始版本</Badge>
            )}
            <Badge className={status.className}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-gtext-muted">
            版本 v{version.version} · {version.scope === 'PLATFORM' ? '平台版本' : '企业版本'}
            {version.enterprise ? ` · 来源企业：${version.enterprise.name}` : ''}
          </p>
        </div>
      </header>
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card className="min-h-[70vh] p-5">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="bg-glass-1">
              <TabsTrigger value="rendered">渲染视图</TabsTrigger>
              <TabsTrigger value="source">Markdown</TabsTrigger>
            </TabsList>
            <TabsContent value="rendered" className="mt-4">
              <Markdown content={version.content} />
            </TabsContent>
            <TabsContent value="source" className="mt-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gtext-secondary">
                {version.content}
              </pre>
            </TabsContent>
          </Tabs>
        </Card>
        <aside className="space-y-4">
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
              <div>
                <dt className="text-gtext-muted">更新时间</dt>
                <dd className="mt-1 text-gtext-secondary">
                  {new Date(version.updatedAt).toLocaleString('zh-CN')}
                </dd>
              </div>
            </dl>
          </Card>

          {promoted && (
            <Card className="p-5">
              <h2 className="font-medium text-gtext-primary">已收录</h2>
              <p className="mt-2 text-sm text-gtext-secondary">
                这一版已经收录为平台版 v{promoted.version}（
                {SKILL_VERSION_STATUS[promoted.status].label}），同一个企业版本只收一次。
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
              <h2 className="font-medium text-gtext-primary">采纳到平台</h2>
              <p className="mt-2 text-xs text-gtext-muted">
                企业没有投稿也可以采纳 —— 会复制成独立的平台版本，这家企业自己在用的版本不受影响。
              </p>
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
                  onClick={() => runAdopt('DRAFT')}
                  loading={adopt.isPending}
                >
                  <Inbox className="h-4 w-4" /> 收为待审草稿
                </Button>
                <Button
                  variant="glass-primary"
                  className="w-full"
                  onClick={() => setConfirmPublish(true)}
                  loading={adopt.isPending}
                >
                  <Rocket className="h-4 w-4" /> 直接发布为平台版
                </Button>
              </div>
            </Card>
          )}

          {pending && (
            <Card className="p-5">
              <h2 className="font-medium text-gtext-primary">审核决定</h2>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={5}
                placeholder="驳回时必须填写原因"
                className="mt-4 w-full resize-none rounded-md border border-glassline bg-glass-1 p-3 text-sm text-gtext-primary focus:outline-none focus:ring-2 focus:ring-gbrand-ring"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="glass" onClick={() => decide('REJECT')} loading={review.isPending}>
                  <X className="h-4 w-4" /> 驳回
                </Button>
                <Button
                  variant="glass-primary"
                  onClick={() => decide('APPROVE')}
                  loading={review.isPending}
                >
                  <Check className="h-4 w-4" /> 通过
                </Button>
              </div>
            </Card>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title="直接发布为平台版？"
        description="跳过审核直接生效：这一版会成为该技能的平台默认版本，所有还钉在旧平台版上的员工模板都会跟着换版。企业自己定制过的版本不受影响。"
        confirmText="发布"
        loading={adopt.isPending}
        onConfirm={() => runAdopt('PUBLISH')}
      />
    </div>
  );
}
