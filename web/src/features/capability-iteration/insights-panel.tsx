'use client';

import { useState } from 'react';
import { Check, Loader2, Sparkles, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  useCapabilityInsights,
  useGenerateInsight,
  usePersonalDiffs,
  useResolveInsight,
  type CapabilityInsight,
  type InsightFinding,
} from './use-capability-iteration';

/**
 * 迭代建议（会议纪要2 §6.5）。
 *
 * 两个入口都要有：对全部使用者一键分析、针对单个成员分析。
 * 采纳时把建议合进正文由**管理员确认后**提交 —— 模型的输出不是最终答案，
 * 直接写进生效正文出错时没人拦得住。
 */
export function InsightsPanel({
  capabilityId,
  canManage,
}: {
  capabilityId: string;
  canManage: boolean;
}) {
  const { data: insights, isLoading } = useCapabilityInsights(capabilityId, canManage);
  const { data: diffs } = usePersonalDiffs(capabilityId, canManage);
  const generate = useGenerateInsight(capabilityId);
  const [memberId, setMemberId] = useState('');

  if (!canManage) {
    return (
      <p className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-10 text-center text-xs text-gtext-muted">
        迭代建议仅企业管理员可见
      </p>
    );
  }

  const members = (diffs?.items ?? [])
    .map((item) => item.owner)
    .filter((owner): owner is NonNullable<typeof owner> => Boolean(owner));

  const runGenerate = (scope: 'ALL' | 'MEMBER') => {
    generate.mutate(
      scope === 'ALL' ? { scope } : { scope, memberId },
      {
        onSuccess: (result) => {
          const count = result.findings?.length ?? 0;
          if (count === 0) {
            toast.success('分析完成', '模型认为暂无值得沉淀的内容');
          } else {
            toast.success(`分析完成，得到 ${count} 条建议`);
          }
        },
        onError: (err) => toast.error('分析失败', (err as Error).message),
      },
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-glass-lg border border-glassline bg-glass-1 p-4">
        <h3 className="text-sm font-semibold text-gtext-primary">生成迭代建议</h3>
        <p className="mt-1 text-[11px] leading-5 text-gtext-muted">
          从成员的使用记录与个人改动里提取「值得升级进企业统一版本」的共性改进点。
          建议不会自动生效，需要你确认后采纳。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="glass-primary"
            loading={generate.isPending}
            onClick={() => runGenerate('ALL')}
            className="h-7 px-2.5 text-[11px]"
          >
            <Users className="h-3 w-3" />
            一键分析全部使用者
          </Button>
          {members.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                className="h-7 rounded-glass-md border border-glassline bg-glass-2 px-2 text-[11px] text-gtext-primary outline-none focus:border-glassline-brand"
              >
                <option value="">选择成员…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name ?? member.email}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="glass"
                disabled={!memberId}
                loading={generate.isPending}
                onClick={() => runGenerate('MEMBER')}
                className="h-7 px-2.5 text-[11px]"
              >
                <Sparkles className="h-3 w-3" />
                只分析这位成员
              </Button>
            </div>
          )}
        </div>
        {generate.isPending && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-gtext-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            模型正在读取使用记录与改动，通常 10–30 秒
          </p>
        )}
      </section>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-glass-lg border border-glassline bg-glass-1" />
      ) : (insights ?? []).length === 0 ? (
        <p className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-10 text-center text-xs text-gtext-muted">
          还没有生成过建议
        </p>
      ) : (
        <div className="space-y-2.5">
          {(insights ?? []).map((insight) => (
            <InsightCard
              key={insight.id}
              capabilityId={capabilityId}
              insight={insight}
              baselineContent={diffs?.baseline?.content ?? ''}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InsightCard({
  capabilityId,
  insight,
  baselineContent,
}: {
  capabilityId: string;
  insight: CapabilityInsight;
  baselineContent: string;
}) {
  const { adopt, dismiss } = useResolveInsight(capabilityId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const statusMeta = {
    PENDING: { label: '待处理', className: 'bg-gbrand/15 text-gbrand-text' },
    ADOPTED: { label: '已采纳', className: 'bg-gsuccess/15 text-gsuccess' },
    DISMISSED: { label: '已拒绝', className: 'bg-glass-3 text-gtext-muted' },
  }[insight.status];

  return (
    <div className="rounded-glass-lg border border-glassline bg-glass-1 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-glass-pill px-1.5 py-0.5 text-[10px] font-medium',
            statusMeta.className,
          )}
        >
          {statusMeta.label}
        </span>
        <span className="text-[11px] text-gtext-secondary">
          {insight.scope === 'ALL' ? '全员分析' : '单成员分析'}
        </span>
        {/* 样本量决定建议可信度 —— 看 3 条记录和看 300 条得出的结论不是一回事 */}
        <span className="text-[11px] text-gtext-muted">
          样本 {insight.sampleSize} 条执行 · {insight.personalCount} 份个人改动
        </span>
        <span className="ml-auto text-[11px] text-gtext-muted">
          {new Date(insight.createdAt).toLocaleString('zh-CN')}
        </span>
      </div>

      {insight.findings.length === 0 ? (
        <p className="mt-2.5 rounded-glass-md bg-glass-2 px-2.5 py-2 text-[11px] text-gtext-muted">
          模型认为暂无值得沉淀的内容 —— 这不是失败，硬凑建议才是。
        </p>
      ) : (
        <ol className="mt-2.5 space-y-2">
          {insight.findings.map((finding, index) => (
            <FindingRow key={index} index={index} finding={finding} />
          ))}
        </ol>
      )}

      {insight.status === 'PENDING' && insight.findings.length > 0 && (
        <div className="mt-3">
          {editing ? (
            <div className="space-y-2">
              <p className="text-[11px] text-gtext-muted">
                在当前生效正文上按建议修改，确认后生成新的企业版本并立即生效。
              </p>
              <Textarea
                glass
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-[280px] resize-y font-mono text-[11px] leading-5"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="glass-primary"
                  loading={adopt.isPending}
                  onClick={() =>
                    adopt.mutate(
                      { insightId: insight.id, content: draft },
                      {
                        onSuccess: () => {
                          toast.success('已采纳', '生成新企业版本并对全部雇佣关系生效');
                          setEditing(false);
                        },
                        onError: (err) => toast.error('采纳失败', (err as Error).message),
                      },
                    )
                  }
                  className="h-7 px-2.5 text-[11px]"
                >
                  <Check className="h-3 w-3" />
                  确认采纳并生效
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
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="glass-primary"
                onClick={() => {
                  setDraft(baselineContent);
                  setEditing(true);
                }}
                className="h-7 px-2.5 text-[11px]"
              >
                采纳（编辑正文）
              </Button>
              <Button
                size="sm"
                variant="glass"
                loading={dismiss.isPending}
                onClick={() =>
                  dismiss.mutate(insight.id, {
                    onSuccess: () => toast.success('已拒绝该建议'),
                    onError: (err) => toast.error('操作失败', (err as Error).message),
                  })
                }
                className="h-7 px-2.5 text-[11px] text-gtext-muted"
              >
                <X className="h-3 w-3" />
                拒绝
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({ index, finding }: { index: number; finding: InsightFinding }) {
  // 低置信度的建议要弱化，不能和高置信度并列 —— 否则管理员无从判断该信哪条
  const strong = finding.confidence >= 0.7;
  return (
    <li className={cn('rounded-glass-md border p-2.5', strong ? 'border-glassline bg-glass-2' : 'border-dashed border-glassline bg-transparent')}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-[11px] font-semibold tabular-nums text-gtext-muted">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs leading-5', strong ? 'text-gtext-primary' : 'text-gtext-secondary')}>
            {finding.suggestion}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-gtext-muted">
            依据：{finding.phenomenon}
          </p>
          {finding.affectedSnippet && (
            <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-glass-3 p-1.5 font-mono text-[10px] leading-4 text-gtext-muted">
              {finding.affectedSnippet}
            </pre>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-glass-pill px-1.5 py-0.5 text-[10px] tabular-nums',
            strong ? 'bg-gsuccess/15 text-gsuccess' : 'bg-glass-3 text-gtext-muted',
          )}
          title="证据强度：多人一致且有使用记录支撑时更高"
        >
          {Math.round(finding.confidence * 100)}%
        </span>
      </div>
    </li>
  );
}
