'use client';

import Link from 'next/link';
import { ArrowRight, Bot, TrendingDown, Zap } from 'lucide-react';
import { ComputeBalanceStrip } from './compute-balance-strip';
import { MemberAllowancePanel } from './member-allowance-panel';
import { UsageRecordTable } from './usage-record-table';

/**
 * 算力余额页。
 *
 * 这一页只回答两件事：**企业为算力留了多少钱、这些钱怎么分给碳基员工、花在哪**。
 *
 * 三处刻意不放在这里：
 *   · 企业钱包余额与资金流水 → `/wallet`（这一页显示的是从钱包充值进来的算力）
 *   · 硅基员工自带的赠送额度 → 「硅基员工」页每张卡片（那是员工的属性，不是企业算力池）
 *   · 按部门 / 员工的花费分布 → `/usage`
 */
export default function ComputeQuotaPage() {
  return (
    <div className="space-y-8 pb-10">
      <section className="border-b border-border/70 pb-7">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-primary">
          <Zap className="h-3.5 w-3.5" />
          企业算力中心
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">算力余额</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">
          算力余额、给碳基员工的分配额度与消费明细
        </p>
      </section>

      <ComputeBalanceStrip />

      <MemberAllowancePanel />

      <section id="usage-records" className="scroll-mt-8">
        <div className="mb-4">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <TrendingDown className="h-4 w-4 text-sky-600" />
            算力消费明细
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            每次模型调用的人民币成本与扣费来源。Token 是用量明细，不是可购买的余额。
          </p>
        </div>
        <UsageRecordTable />
      </section>

      {/* 赠送额度从本页移走了，得告诉用户去哪找 —— 否则会以为功能没了 */}
      <Link
        href="/my-employees"
        className="flex items-center justify-between gap-3 border border-border/70 bg-card px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Bot className="h-4 w-4 text-emerald-600" />
          查看每位硅基员工自带的赠送算力余额
        </span>
        <span className="flex items-center gap-1 text-xs text-fg-muted">
          在「硅基员工」页的卡片上，赠送额度随订阅发放、只属于对应员工
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    </div>
  );
}
