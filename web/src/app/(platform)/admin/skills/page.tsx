'use client';

import Link from 'next/link';
import { CheckSquare, ChevronRight, FileCheck2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import { useAdminSkillVersions } from '@/features/skill-version/use-skill-version';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function AdminSkillsPage() {
  const [filter, setFilter] = useState<'ALL' | 'PENDING_PLATFORM_REVIEW' | 'ENTERPRISE'>('PENDING_PLATFORM_REVIEW');
  const query = useAdminSkillVersions(filter === 'ALL' ? undefined : filter === 'ENTERPRISE' ? { scope: 'ENTERPRISE' } : { status: 'PENDING_PLATFORM_REVIEW' });

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><CheckSquare className="h-5 w-5 text-gbrand-text" /><h1 className="text-2xl font-semibold text-gtext-primary">技能审核</h1></div>
          <p className="mt-1 text-sm text-gtext-muted">审核平台新版本和企业提交版本，已发布版本保持不可变。</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={filter === 'PENDING_PLATFORM_REVIEW' ? 'glass-primary' : 'glass'} onClick={() => setFilter('PENDING_PLATFORM_REVIEW')}>待审核</Button>
          <Button size="sm" variant={filter === 'ENTERPRISE' ? 'glass-primary' : 'glass'} onClick={() => setFilter('ENTERPRISE')}>企业提交</Button>
          <Button size="sm" variant={filter === 'ALL' ? 'glass-primary' : 'glass'} onClick={() => setFilter('ALL')}>全部</Button>
        </div>
      </header>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <CenteredSpinner label="加载技能版本..." />
        ) : query.data?.items.length ? (
          <div className="divide-y divide-glassline">
            {query.data.items.map((version) => {
              const status = SKILL_VERSION_STATUS[version.status];
              return (
                <Link
                  key={version.id}
                  href={`/admin/skills/${version.id}`}
                  className="flex items-center gap-4 p-5 transition-colors hover:bg-glass-1"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gbrand/15 text-gbrand-text">
                    <FileCheck2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-gtext-primary">{version.capability.name}</h2>
                      <Badge className={status.className}>{status.label}</Badge>
                      <span className="text-xs text-gtext-muted">v{version.version}</span>
                      {!version.parentVersionId && !version.sourceVersionId && <Badge variant="glass-info">原始版本</Badge>}
                    </div>
                    <p className="mt-1 truncate text-sm text-gtext-secondary">
                      {version.changeSummary || (!version.parentVersionId && !version.sourceVersionId ? '技能原始正文，后续版本从此版本派生' : '未填写变更说明')}
                    </p>
                    {version.enterprise && (
                      <p className="mt-1 text-xs text-gtext-muted">来源企业：{version.enterprise.name}</p>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-gtext-muted" />
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState title="暂无技能版本" description="上传技能或企业提交版本后会显示在这里。" />
        )}
      </Card>
    </div>
  );
}
