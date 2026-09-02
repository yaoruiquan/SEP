'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  FilePenLine,
  GitCompare,
  Loader2,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { diffLines } from './diff-lines';
import {
  useAdoptPersonalVersions,
  useCreatePersonalVersion,
  useDiscardPersonalVersion,
  usePersonalDiffs,
  useUpdatePersonalVersion,
  type PersonalDiffItem,
} from './use-capability-iteration';

/**
 * 「大家的改动」（管理员）/「我的副本」（成员）。
 *
 * 这是会议纪要2 §6.4 的落点：员工改自己的副本、改完立刻生效、**不提审**；
 * 管理员天然可见并可逐条或一键采纳。所以这一屏刻意没有「提交审核」按钮 ——
 * 那正是会议明确否掉的设计。
 */
export function PersonalChangesPanel({
  capabilityId,
  currentUserId,
}: {
  capabilityId: string;
  currentUserId: string | null;
}) {
  const { data, isLoading, isError, error } = usePersonalDiffs(capabilityId);
  const createVersion = useCreatePersonalVersion(capabilityId);
  const adopt = useAdoptPersonalVersions(capabilityId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-glass-lg border border-glassline bg-glass-1" />;
  }

  if (isError) {
    return (
      <p className="rounded-glass-lg border border-gdanger/25 bg-gdanger/[0.06] px-4 py-6 text-center text-sm text-gdanger">
        {error instanceof Error ? error.message : '改动列表加载失败'}
      </p>
    );
  }

  const canManage = data?.canManage ?? false;
  const items = data?.items ?? [];
  const mine = items.find((item) => item.owner?.id === currentUserId);
  const others = items.filter((item) => item.owner?.id !== currentUserId);
  const pendingIds = items.filter((item) => item.pending).map((item) => item.id);

  const handleAdoptSelected = () => {
    if (selected.size === 0) return;
    adopt.mutate(
      { sourceVersionIds: [...selected] },
      {
        onSuccess: (result) => {
          toast.success(
            `已采纳 ${result.adoptedCount} 条改动`,
            `生成新企业版本并对 ${result.affectedSubscriptions} 个雇佣关系生效`,
          );
          setSelected(new Set());
        },
        onError: (err) => toast.error('采纳失败', (err as Error).message),
      },
    );
  };

  return (
    <div className="space-y-4">
      <MyCopyCard
        capabilityId={capabilityId}
        mine={mine}
        baselineContent={data?.baseline?.content ?? ''}
        onCreate={() =>
          createVersion.mutate(undefined, {
            onSuccess: () => toast.success('已创建我的副本', '改完即生效，不需要提交审核'),
            onError: (err) => toast.error('创建失败', (err as Error).message),
          })
        }
        creating={createVersion.isPending}
      />

      {canManage && (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gtext-primary">大家的改动</h3>
              <p className="mt-0.5 text-[11px] text-gtext-muted">
                成员不需要提交审核，改动天然可见。可逐条采纳，也可多选后一键采纳。
              </p>
            </div>
            {pendingIds.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelected((prev) =>
                      prev.size === pendingIds.length ? new Set() : new Set(pendingIds),
                    )
                  }
                  className="text-[11px] text-gtext-secondary underline-offset-2 hover:underline"
                >
                  {selected.size === pendingIds.length ? '取消全选' : `全选 ${pendingIds.length} 条`}
                </button>
                <Button
                  size="sm"
                  variant="glass-primary"
                  disabled={selected.size === 0}
                  loading={adopt.isPending}
                  onClick={handleAdoptSelected}
                  className="h-7 px-2.5 text-[11px]"
                >
                  <Check className="h-3 w-3" />
                  一键采纳{selected.size > 0 ? ` ${selected.size} 条` : ''}
                </Button>
              </div>
            )}
          </div>

          {others.length === 0 ? (
            <p className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-8 text-center text-xs text-gtext-muted">
              还没有其他成员改过这个技能
            </p>
          ) : (
            <div className="space-y-2">
              {others.map((item) => (
                <ChangeCard
                  key={item.id}
                  item={item}
                  baselineContent={data?.baseline?.content ?? ''}
                  selected={selected.has(item.id)}
                  onSelectChange={(checked) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    })
                  }
                  onAdopt={() =>
                    adopt.mutate(
                      { sourceVersionIds: [item.id] },
                      {
                        onSuccess: () =>
                          toast.success(`已采纳 ${item.owner?.name ?? '成员'} 的改动`),
                        onError: (err) => toast.error('采纳失败', (err as Error).message),
                      },
                    )
                  }
                  adopting={adopt.isPending}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** 我的副本：没有就给创建入口，有就能直接编辑。编辑没有「提交」这一步。 */
function MyCopyCard({
  capabilityId,
  mine,
  baselineContent,
  onCreate,
  creating,
}: {
  capabilityId: string;
  mine: PersonalDiffItem | undefined;
  baselineContent: string;
  onCreate: () => void;
  creating: boolean;
}) {
  const update = useUpdatePersonalVersion(capabilityId);
  const discard = useDiscardPersonalVersion(capabilityId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [summary, setSummary] = useState('');

  if (!mine) {
    return (
      <section className="rounded-glass-lg border border-glassline bg-glass-1 p-4">
        <h3 className="text-sm font-semibold text-gtext-primary">我的副本</h3>
        <p className="mt-1 text-[11px] leading-5 text-gtext-muted">
          基于当前生效版本创建你自己的副本。改完**立刻对你本人生效**，不需要提交审核；
          企业管理员能看到你改了什么，可以采纳进企业统一版本。
        </p>
        <Button
          size="sm"
          variant="glass-primary"
          loading={creating}
          onClick={onCreate}
          className="mt-3 h-7 px-2.5 text-[11px]"
        >
          <FilePenLine className="h-3 w-3" />
          创建我的副本
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-glass-lg border border-gsuccess/35 bg-gsuccess/[0.05] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-gtext-primary">
            我的副本
            <span className="rounded-glass-pill bg-gsuccess/15 px-1.5 py-0.5 text-[10px] font-medium text-gsuccess">
              已生效
            </span>
          </h3>
          <p className="mt-1 text-[11px] text-gtext-muted">
            {mine.basedOn
              ? `基于 ${scopeLabel(mine.basedOn.scope)} ${mine.basedOn.version}`
              : '基于当前生效版本'}
            {mine.adopted ? ' · 已被企业采纳过' : mine.pending ? ' · 等待企业采纳' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {!editing && (
            <Button
              size="sm"
              variant="glass"
              onClick={() => {
                setDraft(mine.content);
                setSummary(mine.changeSummary ?? '');
                setEditing(true);
              }}
              className="h-7 px-2.5 text-[11px]"
            >
              <FilePenLine className="h-3 w-3" />
              编辑
            </Button>
          )}
          <Button
            size="sm"
            variant="glass"
            loading={discard.isPending}
            onClick={() =>
              discard.mutate(mine.id, {
                onSuccess: () => toast.success('已弃用副本', '回落到企业生效版本'),
                onError: (err) => toast.error('弃用失败', (err as Error).message),
              })
            }
            className="h-7 px-2.5 text-[11px] text-gdanger"
          >
            <Trash2 className="h-3 w-3" />
            弃用
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea
            glass
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-[280px] resize-y font-mono text-[11px] leading-5"
          />
          <Textarea
            glass
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="这次改了什么？管理员看到的就是这句话（选填，但填了更容易被采纳）"
            className="min-h-16 resize-y text-xs"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="glass-primary"
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  { versionId: mine.id, content: draft, changeSummary: summary || undefined },
                  {
                    onSuccess: () => {
                      toast.success('已保存', '下一句对话就会用上新内容');
                      setEditing(false);
                    },
                    onError: (err) => toast.error('保存失败', (err as Error).message),
                  },
                )
              }
              className="h-7 px-2.5 text-[11px]"
            >
              保存并生效
            </Button>
            <Button
              size="sm"
              variant="glass"
              onClick={() => setEditing(false)}
              className="h-7 px-2.5 text-[11px]"
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <DiffView baseline={baselineContent} current={mine.content} />
      )}
    </section>
  );
}

function ChangeCard({
  item,
  baselineContent,
  selected,
  onSelectChange,
  onAdopt,
  adopting,
}: {
  item: PersonalDiffItem;
  baselineContent: string;
  selected: boolean;
  onSelectChange: (checked: boolean) => void;
  onAdopt: () => void;
  adopting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={cn(
        'rounded-glass-lg border bg-glass-1 p-3 transition-colors',
        selected ? 'border-glassline-brand bg-gbrand/[0.05]' : 'border-glassline',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {item.pending && (
          <Checkbox checked={selected} onCheckedChange={(checked) => onSelectChange(Boolean(checked))} />
        )}
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gtext-primary">
          <UserRound className="h-3.5 w-3.5 text-gtext-muted" />
          {item.owner?.name ?? '未知成员'}
        </span>
        {item.pending ? (
          <span className="rounded-glass-pill bg-gbrand/15 px-1.5 py-0.5 text-[10px] font-medium text-gbrand-text">
            {item.adopted ? '采纳后又改过' : '待采纳'}
          </span>
        ) : (
          <span className="rounded-glass-pill bg-glass-3 px-1.5 py-0.5 text-[10px] text-gtext-muted">
            已采纳
          </span>
        )}
        <span className="text-[11px] text-gtext-muted">
          {new Date(item.updatedAt).toLocaleString('zh-CN')}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[11px] text-gtext-secondary underline-offset-2 hover:underline"
          >
            <GitCompare className="h-3 w-3" />
            {expanded ? '收起差异' : '看差异'}
          </button>
          {item.pending && (
            <Button
              size="sm"
              variant="glass"
              loading={adopting}
              onClick={onAdopt}
              className="h-7 px-2.5 text-[11px]"
            >
              采纳
            </Button>
          )}
        </div>
      </div>

      {item.changeSummary && (
        <p className="mt-1.5 text-xs leading-5 text-gtext-secondary">{item.changeSummary}</p>
      )}

      {expanded && <DiffView baseline={baselineContent} current={item.content} />}
    </div>
  );
}

/**
 * 行级差异。
 *
 * 只显示变化的行及其上下文 —— 技能正文动辄几百行，全文并排看不出改了哪。
 * 没有引入 diff 库：`diffLines` 是 40 行的 LCS，够用且不增加依赖。
 */
function DiffView({ baseline, current }: { baseline: string; current: string }) {
  const rows = useMemo(() => diffLines(baseline, current), [baseline, current]);
  const changed = rows.filter((row) => row.type !== 'same').length;

  if (!baseline) {
    return (
      <pre className="mt-2 max-h-72 overflow-auto rounded-glass-md bg-glass-2 p-2.5 font-mono text-[11px] leading-5 text-gtext-secondary">
        {current}
      </pre>
    );
  }

  if (changed === 0) {
    return (
      <p className="mt-2 rounded-glass-md bg-glass-2 px-2.5 py-2 text-[11px] text-gtext-muted">
        与当前生效版本内容相同
      </p>
    );
  }

  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-glass-md bg-glass-2 font-mono text-[11px] leading-5">
      {rows.map((row, index) => (
        <div
          key={`${index}-${row.type}`}
          className={cn(
            'whitespace-pre-wrap break-all px-2.5',
            row.type === 'added' && 'bg-gsuccess/10 text-gsuccess',
            row.type === 'removed' && 'bg-gdanger/10 text-gdanger line-through decoration-1',
            row.type === 'same' && 'text-gtext-muted',
            row.type === 'gap' && 'select-none bg-glass-3 text-center text-gtext-disabled',
          )}
        >
          {row.type === 'gap' ? '⋯' : `${row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' '} ${row.text}`}
        </div>
      ))}
    </div>
  );
}

function scopeLabel(scope: string) {
  if (scope === 'ENTERPRISE') return '企业版';
  if (scope === 'PERSONAL') return '个人副本';
  return '平台版';
}
