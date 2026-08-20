'use client';

import Link from 'next/link';
import { ChevronRight, FileCheck2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import { useAdminSkillVersions } from '@/features/skill-version/use-skill-version';

export default function AdminSkillsPage() {
  const query = useAdminSkillVersions();

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-gtext-primary">技能版本管理</h1>
        <p className="mt-1 text-sm text-gtext-muted">
          审核平台新版本和企业提交版本，已发布版本保持不可变。
        </p>
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
                    </div>
                    <p className="mt-1 truncate text-sm text-gtext-secondary">
                      {version.changeSummary || '未填写变更说明'}
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
