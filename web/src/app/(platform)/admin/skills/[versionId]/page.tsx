'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { Markdown } from '@/features/chat/markdown';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import {
  useReviewPlatformSkillVersion,
  useSkillVersionPreview,
} from '@/features/skill-version/use-skill-version';

export default function AdminSkillVersionDetailPage() {
  const { versionId = '' } = useParams<{ versionId: string }>();
  const router = useRouter();
  const query = useSkillVersionPreview(versionId, 'admin');
  const review = useReviewPlatformSkillVersion();
  const [reason, setReason] = useState('');
  const [tab, setTab] = useState('rendered');

  if (query.isLoading) return <CenteredSpinner label="加载审核详情..." />;
  if (!query.data) return <div className="p-6 text-sm text-gdanger">技能版本不存在。</div>;
  const status = SKILL_VERSION_STATUS[query.data.status];
  const pending = query.data.status === 'PENDING_PLATFORM_REVIEW';

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

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <button onClick={() => router.push('/admin/skills')} className="inline-flex items-center gap-2 text-sm text-gtext-secondary hover:text-gtext-primary">
        <ArrowLeft className="h-4 w-4" /> 返回技能版本
      </button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-gtext-primary">{query.data.capability.name}</h1>
            {!query.data.parentVersionId && !query.data.sourceVersionId && <Badge variant="glass-info">原始版本</Badge>}
            <Badge className={status.className}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-gtext-muted">版本 v{query.data.version} · {query.data.scope === 'PLATFORM' ? '平台版本' : '企业版本'}</p>
        </div>
      </header>
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card className="min-h-[70vh] p-5">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="bg-glass-1">
              <TabsTrigger value="rendered">渲染视图</TabsTrigger>
              <TabsTrigger value="source">Markdown</TabsTrigger>
            </TabsList>
            <TabsContent value="rendered" className="mt-4"><Markdown content={query.data.content} /></TabsContent>
            <TabsContent value="source" className="mt-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gtext-secondary">{query.data.content}</pre>
            </TabsContent>
          </Tabs>
        </Card>
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-medium text-gtext-primary">版本信息</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-gtext-muted">变更说明</dt><dd className="mt-1 text-gtext-secondary">{query.data.changeSummary || (!query.data.parentVersionId && !query.data.sourceVersionId ? '原始正文' : '未填写')}</dd></div>
              {query.data.parentVersionId && <div><dt className="text-gtext-muted">版本关系</dt><dd className="mt-1 text-gtext-secondary">基于父版本派生，需核对本次变更说明与正文是否一致。</dd></div>}
              <div><dt className="text-gtext-muted">更新时间</dt><dd className="mt-1 text-gtext-secondary">{new Date(query.data.updatedAt).toLocaleString('zh-CN')}</dd></div>
            </dl>
          </Card>
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
                <Button variant="glass-primary" onClick={() => decide('APPROVE')} loading={review.isPending}>
                  <Check className="h-4 w-4" /> 通过
                </Button>
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
