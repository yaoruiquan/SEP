'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, CheckSquare, ChevronDown, ChevronRight, FileCheck2, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { SKILL_VERSION_STATUS } from '@/features/skill-version/status';
import {
  groupAdminVersions,
  type AdminVersionRow,
  type CapabilityGroup,
} from '@/features/skill-version/group-admin-versions';
import { useAdminSkillVersions } from '@/features/skill-version/use-skill-version';

/**
 * 三个页签对应三个问题，标签就照着问题写：
 *   - 待审核：有人投稿了，等我批
 *   - 企业改动：各家企业自己改成了什么样，我要不要收回平台（**没有投稿也在这里**）
 *   - 全部：翻档案
 *
 * 第二个页签原来叫「企业提交」，是错的：它查的是 `scope=ENTERPRISE`，而投稿会复制成
 * `scope=PLATFORM` 的副本落到第一个页签。实测这一栏 11 行里 0 行是提交过来的。
 */
const TABS = [
  { key: 'PENDING', label: '待审核', filter: { status: 'PENDING_PLATFORM_REVIEW' } as const },
  { key: 'ENTERPRISE', label: '企业改动', filter: { scope: 'ENTERPRISE' } as const },
  { key: 'ALL', label: '全部', filter: undefined },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const TAB_HINT: Record<TabKey, string> = {
  PENDING: '企业投稿和平台自建草稿提交上来的版本，等你通过或驳回。',
  ENTERPRISE: '各家企业在本企业范围内改出来的版本。企业没有投稿，平台也可以直接采纳。',
  ALL: '平台版与企业版全量（个人副本不进审核列表）。',
};

export default function AdminSkillsPage() {
  const [tab, setTab] = useState<TabKey>('PENDING');
  const active = TABS.find((item) => item.key === tab)!;
  const query = useAdminSkillVersions(active.filter);
  const groups = useMemo(() => groupAdminVersions(query.data?.items ?? []), [query.data]);
  const truncated = query.data ? query.data.total > query.data.items.length : false;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-gbrand-text" />
            <h1 className="text-2xl font-semibold text-gtext-primary">技能审核</h1>
          </div>
          <p className="mt-1 text-sm text-gtext-muted">
            {TAB_HINT[tab]}
            {truncated && (
              <span className="text-gwarning">
                {' '}
                共 {query.data!.total} 个版本，当前只显示最近 {query.data!.items.length} 个。
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {TABS.map((item) => (
            <Button
              key={item.key}
              size="sm"
              variant={tab === item.key ? 'glass-primary' : 'glass'}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </header>

      {query.isLoading ? (
        <Card className="overflow-hidden">
          <CenteredSpinner label="加载技能版本..." />
        </Card>
      ) : groups.length ? (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                {group.isPlatform ? (
                  <Layers className="h-4 w-4 text-gtext-muted" />
                ) : (
                  <Building2 className="h-4 w-4 text-gtext-muted" />
                )}
                <h2 className="text-sm font-medium text-gtext-primary">{group.name}</h2>
                <span className="text-xs text-gtext-muted">
                  {group.capabilities.length} 个技能 · {group.versionCount} 个版本
                </span>
              </div>
              <Card className="overflow-hidden">
                <div className="divide-y divide-glassline">
                  {group.capabilities.map((capability) => (
                    <CapabilityRow key={capability.capabilityId} group={capability} />
                  ))}
                </div>
              </Card>
            </section>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <EmptyState title="暂无技能版本" description={TAB_HINT[tab]} />
        </Card>
      )}
    </div>
  );
}

function CapabilityRow({ group }: { group: CapabilityGroup }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <VersionLine row={group.latest} capabilityName={group.capabilityName} highlight />
      {group.older.length > 0 && (
        <div className="border-t border-glassline/60 bg-glass-1/40">
          <button
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-2 px-5 py-2 text-xs text-gtext-muted transition-colors hover:text-gtext-secondary"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`}
            />
            {group.older.length} 个更早的版本
          </button>
          {expanded && (
            <div className="divide-y divide-glassline/60">
              {group.older.map((row) => (
                <VersionLine key={row.id} row={row} capabilityName={group.capabilityName} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VersionLine({
  row,
  capabilityName,
  highlight = false,
}: {
  row: AdminVersionRow;
  capabilityName: string;
  highlight?: boolean;
}) {
  const status = SKILL_VERSION_STATUS[row.status];
  // 「原始版本」只在真的没有上游时成立。采纳产生的版本以前也落在这里 ——
  // 后端漏写 parentVersionId，一条「采纳 XX 的改动」被标成原始正文。
  const isOriginal = !row.parentVersionId && !row.sourceVersionId;
  return (
    <Link
      href={`/admin/skills/${row.id}`}
      className={`flex items-center gap-4 px-5 transition-colors hover:bg-glass-1 ${
        highlight ? 'py-4' : 'py-3 pl-11'
      }`}
    >
      {highlight && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gbrand/15 text-gbrand-text">
          <FileCheck2 className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {highlight && (
            <span className="font-medium text-gtext-primary">{capabilityName}</span>
          )}
          <span className={highlight ? 'text-xs text-gtext-muted' : 'text-sm text-gtext-secondary'}>
            {row.scope === 'PLATFORM' ? '平台版' : '企业版'} v{row.version}
          </span>
          <Badge className={status.className}>{status.label}</Badge>
          {row.sourceVersionId && <Badge variant="glass-info">来自企业版本</Badge>}
          {isOriginal && <Badge variant="glass-info">原始版本</Badge>}
        </div>
        <p className="mt-1 truncate text-sm text-gtext-secondary">
          {row.changeSummary || (isOriginal ? '技能原始正文，后续版本从此版本派生' : '未填写变更说明')}
        </p>
      </div>
      <span className="shrink-0 text-xs text-gtext-muted">
        {new Date(row.updatedAt).toLocaleDateString('zh-CN')}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-gtext-muted" />
    </Link>
  );
}
