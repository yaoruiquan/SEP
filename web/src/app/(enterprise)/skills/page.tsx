'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Eye, FileCode2, Send, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { SkillVersionPreviewDialog } from '@/features/skill-version/SkillVersionPreviewDialog';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import {
  useEnterpriseSkillVersions,
  useReviewEnterpriseSkillVersion,
  useSubmitPlatformSkillReview,
} from '@/features/skill-version/use-skill-version';

export default function EnterpriseSkillsPage() {
  const query = useEnterpriseSkillVersions();
  const review = useReviewEnterpriseSkillVersion();
  const submitPlatform = useSubmitPlatformSkillReview();
  const role = useAuthStore((state) => state.roleInEnterprise);
  const isAdmin = role === 'ENTERPRISE_ADMIN';
  const [previewId, setPreviewId] = useState('');

  const decide = (id: string, decision: 'APPROVE' | 'REJECT') => {
    const comment = decision === 'REJECT' ? window.prompt('请输入驳回原因')?.trim() : undefined;
    if (decision === 'REJECT' && !comment) return;
    review.mutate(
      { id, decision, comment },
      {
        onSuccess: () => toast.success(decision === 'APPROVE' ? '企业审核已通过' : '版本已驳回'),
        onError: (error) => toast.error(error instanceof Error ? error.message : '审核失败'),
      },
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-gtext-primary">技能管理</h1>
        <p className="mt-1 text-sm text-gtext-muted">
          管理企业基于平台技能创建的版本、内部审核和平台提交。
        </p>
      </header>

      <Card className="overflow-hidden">
        {query.isLoading ? (
          <CenteredSpinner label="加载技能版本..." />
        ) : query.data?.length ? (
          <div className="divide-y divide-glassline">
            {query.data.map((version) => {
              const status = SKILL_VERSION_STATUS[version.status];
              return (
                <div key={version.id} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-gtext-primary">{version.capability.name}</h2>
                      <Badge className={status.className}>{status.label}</Badge>
                      <span className="text-xs text-gtext-muted">v{version.version}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-gtext-secondary">
                      {version.changeSummary || '未填写变更说明'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="glass" size="sm" onClick={() => setPreviewId(version.id)}>
                      <Eye className="h-4 w-4" /> 预览
                    </Button>
                    {(version.status === 'DRAFT' || version.status === 'ENTERPRISE_REJECTED') && (
                      <Link
                        href={`/skills/${version.id}/edit`}
                        className={buttonVariants({ variant: 'glass', size: 'sm' })}
                      >
                        <FileCode2 className="h-4 w-4" /> 编辑
                      </Link>
                    )}
                    {isAdmin && version.status === 'PENDING_ENTERPRISE_REVIEW' && (
                      <>
                        <Button variant="glass-primary" size="sm" onClick={() => decide(version.id, 'APPROVE')}>
                          <Check className="h-4 w-4" /> 通过
                        </Button>
                        <Button variant="glass" size="sm" onClick={() => decide(version.id, 'REJECT')}>
                          <X className="h-4 w-4" /> 驳回
                        </Button>
                      </>
                    )}
                    {isAdmin && version.status === 'ENTERPRISE_APPROVED' && !version.hasPlatformSubmission && (
                      <Button
                        variant="glass"
                        size="sm"
                        loading={submitPlatform.isPending}
                        onClick={() =>
                          submitPlatform.mutate(version.id, {
                            onSuccess: () => toast.success('已生成平台审核副本'),
                            onError: (error) => toast.error(error instanceof Error ? error.message : '提交失败'),
                          })
                        }
                      >
                        <Send className="h-4 w-4" /> 提交平台
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="还没有企业技能版本"
            description="在硅基员工详情中选择一个技能，创建企业版本后会显示在这里。"
          />
        )}
      </Card>

      <SkillVersionPreviewDialog
        versionId={previewId}
        open={Boolean(previewId)}
        onOpenChange={(open) => !open && setPreviewId('')}
      />
    </div>
  );
}
