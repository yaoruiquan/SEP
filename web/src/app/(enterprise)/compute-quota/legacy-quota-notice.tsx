'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import {
  useLegacyQuotaSummary,
  useLegacySubscriptionQuotas,
  useLegacyUserQuotas,
  useLegacyEnterpriseQuotas,
} from '@/lib/api/use-quota';

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString('zh-CN');
}

/**
 * 旧 Token 配额的停用提示。
 *
 * 只在企业确实有历史 token 残值时出现 —— 新企业不该看到一段关于「旧体系」的
 * 解释。措辞必须明确说它**不能再使用**：把停用的额度和真实余额并列展示，
 * 比不展示更容易让人误判自己还有多少钱。
 */
export function LegacyQuotaNotice() {
  const [expanded, setExpanded] = useState(false);
  const { data: summary } = useLegacyQuotaSummary();
  const { data: subQuotas } = useLegacySubscriptionQuotas();
  const { data: userQuotas } = useLegacyUserQuotas();
  const { data: entQuotas } = useLegacyEnterpriseQuotas();

  if (!summary) return null;

  const totalRemaining =
    summary.user.remainingTokens +
    summary.subscription.remainingTokens +
    summary.enterprise.remainingTokens;

  if (totalRemaining <= 0) return null;

  return (
    <section className="border border-amber-300/70 bg-amber-50/60 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-900">
            历史 Token 配额已停用
          </h3>
          <p className="mt-1 text-sm leading-6 text-amber-800">
            算力口径已统一为人民币。旧的 Token 配额共剩余{' '}
            <strong className="tabular-nums">{fmtTokens(totalRemaining)} tokens</strong>
            ，<strong>不再参与对话扣费，也无法折算成余额</strong>。
            当前可用余额请看上方的企业钱包与赠送算力。如需处理这批历史额度，请联系平台运营。
          </p>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-900 hover:underline"
          >
            {expanded ? '收起明细' : '查看明细'}
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {expanded && (
            <div className="mt-4 space-y-4 text-xs text-amber-900">
              <LegacyGroup
                title="订阅自带配额"
                rows={(subQuotas ?? []).map((q) => ({
                  key: q.id,
                  label: q.employeeName ?? '硅基员工',
                  remaining: Math.max(0, q.totalTokens - q.usedTokens),
                  status: q.status,
                }))}
              />
              <LegacyGroup
                title="成员个人配额"
                rows={(userQuotas ?? []).map((q) => ({
                  key: q.id,
                  label: q.name ?? q.email,
                  remaining: Math.max(0, q.totalTokens - q.usedTokens),
                  status: q.status,
                }))}
              />
              <LegacyGroup
                title="企业可分配池"
                rows={(entQuotas ?? []).map((q) => ({
                  key: q.id,
                  label: q.type,
                  remaining: Math.max(0, q.totalTokens - q.usedTokens),
                  status: q.status,
                }))}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function LegacyGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; remaining: number; status: string }>;
}) {
  const withRemaining = rows.filter((r) => r.remaining > 0);
  if (withRemaining.length === 0) return null;

  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 space-y-1">
        {withRemaining.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-4">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums line-through opacity-70">
              {fmtTokens(r.remaining)} tokens
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
