/**
 * 存量迁移：为已有订阅补建人民币赠送余额（SubscriptionCredit）。
 *
 * 使用：
 *   pnpm tsx src/scripts/backfill-subscription-credits.ts            # dry-run（默认）
 *   pnpm tsx src/scripts/backfill-subscription-credits.ts --execute  # 真实写入
 *   pnpm tsx src/scripts/backfill-subscription-credits.ts --default-gift 1000
 *
 * 金额来源优先级（每条订阅独立判定）：
 *   1. 该企业该员工**已支付订单**里的 includedComputeCNY 快照 —— 企业实际买到的赠送额度
 *   2. 员工级配置 digital_employees.includedComputeCNY
 *   3. 系统设置 DEFAULT_EMPLOYEE_GIFT_CNY（或 --default-gift 覆盖）
 *
 * 幂等性：以 subscription_credits.subscriptionId 唯一约束为准 —— 已有额度的订阅一律跳过，
 * 绝不追加金额。重复执行只会产出同一份报告，不会重复赠送。
 *
 * ⚠️ 刻意**不做** Token → 人民币折算。旧 SubscriptionQuota 的 token 额度是混合模型口径，
 * 没有可辩护的兑换率；强行折算等于凭空发钱。脚本只在报告里列出这些 token 余额供人工决策。
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

type GiftSource = 'paid-order' | 'employee-config' | 'system-default';

interface PlannedGrant {
  subscriptionId: string;
  enterpriseName: string;
  employeeName: string;
  status: string;
  grantedCNY: Decimal;
  source: GiftSource;
  sourceId: string | null;
  /** 旧 Token 配额残值，仅用于人工对账 */
  legacyQuotaTokensRemaining: number | null;
}

interface Report {
  subscriptionsTotal: number;
  alreadyHasCredit: number;
  planned: PlannedGrant[];
  skippedNoEnterpriseWallet: string[];
  bySource: Record<GiftSource, number>;
  totalGrantCNY: Decimal;
  legacyQuotaTokensTotal: number;
  legacyComputeAccountBalance: Decimal;
  errors: Array<{ subscriptionId: string; error: string }>;
}

async function main() {
  const isDryRun = !process.argv.includes('--execute');
  const defaultGiftOverride = readNumberFlag('--default-gift');

  banner(isDryRun);

  const systemDefault =
    defaultGiftOverride ?? (await readSystemDefaultGiftCNY());
  console.log(`💰 系统默认赠送金额: ¥${systemDefault.toFixed(2)}`);
  if (defaultGiftOverride !== null) {
    console.log('   （来自 --default-gift，覆盖系统设置）');
  }
  console.log();

  const report: Report = {
    subscriptionsTotal: 0,
    alreadyHasCredit: 0,
    planned: [],
    skippedNoEnterpriseWallet: [],
    bySource: { 'paid-order': 0, 'employee-config': 0, 'system-default': 0 },
    totalGrantCNY: new Decimal(0),
    legacyQuotaTokensTotal: 0,
    legacyComputeAccountBalance: new Decimal(0),
    errors: [],
  };

  try {
    await collectPlan(report, systemDefault);
    printPlan(report);

    if (!isDryRun && report.planned.length > 0) {
      await applyPlan(report);
    }

    await printReconciliation(report, isDryRun);
  } finally {
    await prisma.$disconnect();
  }
}

// ── 计划阶段（只读）───────────────────────────────────────────────────────────

async function collectPlan(report: Report, systemDefault: number) {
  // 只迁移「还能用」的订阅。已终止/过期的订阅补额度没有意义，
  // 反而会在企业算力中心里显示出一笔用不掉的余额。
  const subscriptions = await prisma.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'PAUSED'] } },
    include: {
      enterprise: { select: { id: true, name: true } },
      employee: { select: { id: true, name: true, includedComputeCNY: true } },
      credit: { select: { id: true } },
      subscriptionQuota: { select: { totalTokens: true, usedTokens: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  report.subscriptionsTotal = subscriptions.length;

  for (const sub of subscriptions) {
    if (sub.credit) {
      report.alreadyHasCredit++;
      continue;
    }

    try {
      const { amount, source, sourceId } = await resolveGift(
        sub.enterpriseId,
        sub.employeeId,
        sub.employee.includedComputeCNY,
        systemDefault,
      );

      const legacyRemaining = sub.subscriptionQuota
        ? Math.max(
            0,
            sub.subscriptionQuota.totalTokens - sub.subscriptionQuota.usedTokens,
          )
        : null;

      report.planned.push({
        subscriptionId: sub.id,
        enterpriseName: sub.enterprise.name,
        employeeName: sub.name ?? sub.employee.name,
        status: sub.status,
        grantedCNY: amount,
        source,
        sourceId,
        legacyQuotaTokensRemaining: legacyRemaining,
      });
      report.bySource[source]++;
      report.totalGrantCNY = report.totalGrantCNY.add(amount);
      report.legacyQuotaTokensTotal += legacyRemaining ?? 0;
    } catch (error) {
      report.errors.push({
        subscriptionId: sub.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function resolveGift(
  enterpriseId: string,
  employeeId: string,
  employeeOverride: Prisma.Decimal | null,
  systemDefault: number,
): Promise<{ amount: Decimal; source: GiftSource; sourceId: string | null }> {
  // 1. 已支付订单的快照最可信：那是企业当时实际买到的赠送额度
  const paidItem = await prisma.orderItem.findFirst({
    where: {
      employeeId,
      order: { enterpriseId, status: 'PAID' },
    },
    select: { includedComputeCNY: true, orderId: true },
    orderBy: { order: { paidAt: 'desc' } },
  });
  if (paidItem && paidItem.includedComputeCNY.greaterThan(0)) {
    return {
      amount: paidItem.includedComputeCNY,
      source: 'paid-order',
      sourceId: paidItem.orderId,
    };
  }

  // 2. 员工级配置（迁移后为 NULL 表示未配置）
  if (employeeOverride !== null && employeeOverride !== undefined) {
    return {
      amount: new Decimal(employeeOverride),
      source: 'employee-config',
      sourceId: employeeId,
    };
  }

  // 3. 系统默认值
  return {
    amount: new Decimal(systemDefault),
    source: 'system-default',
    sourceId: null,
  };
}

// ── 执行阶段 ─────────────────────────────────────────────────────────────────

async function applyPlan(report: Report) {
  console.log('\n⚙️  开始写入…\n');

  for (const grant of report.planned) {
    try {
      // 每条订阅一个独立事务：一条失败不该拖垮整批，
      // 且 subscriptionId 唯一约束保证重跑不会重复赠送。
      await prisma.$transaction(async (tx) => {
        const sub = await tx.subscription.findUnique({
          where: { id: grant.subscriptionId },
          select: { enterpriseId: true, employeeId: true },
        });
        if (!sub) throw new Error('订阅在计划与执行之间被删除');

        await tx.subscriptionCredit.create({
          data: {
            subscriptionId: grant.subscriptionId,
            enterpriseId: sub.enterpriseId,
            employeeId: sub.employeeId,
            grantedCNY: grant.grantedCNY,
            usedCNY: 0,
            status: grant.grantedCNY.greaterThan(0) ? 'ACTIVE' : 'EXHAUSTED',
            sourceType: 'migration',
            sourceId: grant.sourceId,
          },
        });

        // 旧 Token 配额停用：留着会让企业算力中心同时显示两套额度，
        // 用户无从判断哪个是真的。数据本身保留，只是不再标为可用。
        await tx.subscriptionQuota.updateMany({
          where: { subscriptionId: grant.subscriptionId, status: 'ACTIVE' },
          data: { status: 'EXHAUSTED' },
        });
      });

      console.log(
        `  ✅ ${grant.enterpriseName} / ${grant.employeeName} → ¥${grant.grantedCNY.toFixed(2)} (${grant.source})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ ${grant.subscriptionId}: ${message}`);
      report.errors.push({ subscriptionId: grant.subscriptionId, error: message });
    }
  }
}

// ── 报告 ─────────────────────────────────────────────────────────────────────

function printPlan(report: Report) {
  console.log('─'.repeat(80));
  console.log(`订阅总数（ACTIVE/PAUSED）: ${report.subscriptionsTotal}`);
  console.log(`已有赠送余额，跳过:       ${report.alreadyHasCredit}`);
  console.log(`待补建:                   ${report.planned.length}`);
  console.log('─'.repeat(80));

  if (report.planned.length === 0) {
    console.log('无需补建任何赠送余额。');
    return;
  }

  console.log('\n金额来源分布：');
  console.log(`  已支付订单快照: ${report.bySource['paid-order']}`);
  console.log(`  员工级配置:     ${report.bySource['employee-config']}`);
  console.log(`  系统默认值:     ${report.bySource['system-default']}`);
  console.log(`\n合计赠送金额: ¥${report.totalGrantCNY.toFixed(2)}`);

  console.log('\n明细：');
  for (const g of report.planned) {
    const legacy =
      g.legacyQuotaTokensRemaining !== null
        ? `（旧 Token 配额残值 ${g.legacyQuotaTokensRemaining.toLocaleString()}）`
        : '';
    console.log(
      `  ${g.enterpriseName} / ${g.employeeName} [${g.status}] ` +
        `→ ¥${g.grantedCNY.toFixed(2)} · ${g.source} ${legacy}`,
    );
  }
}

async function printReconciliation(report: Report, isDryRun: boolean) {
  const [walletAgg, accountAgg, creditAgg, grantCount] = await Promise.all([
    prisma.enterpriseWallet.aggregate({ _sum: { balance: true } }),
    prisma.computeAccount.aggregate({ _sum: { balance: true } }),
    prisma.subscriptionCredit.aggregate({
      _sum: { grantedCNY: true, usedCNY: true },
      _count: true,
    }),
    prisma.employeeGrant.count(),
  ]);

  report.legacyComputeAccountBalance = new Decimal(
    accountAgg._sum.balance ?? 0,
  );

  const granted = creditAgg._sum.grantedCNY ?? new Decimal(0);
  const used = creditAgg._sum.usedCNY ?? new Decimal(0);

  console.log('\n' + '='.repeat(80));
  console.log('对账报告');
  console.log('='.repeat(80));
  console.log(`企业钱包余额合计（唯一主账本）: ¥${new Decimal(walletAgg._sum.balance ?? 0).toFixed(2)}`);
  console.log(`赠送余额记录数:                 ${creditAgg._count}`);
  console.log(`赠送额度合计:                   ¥${granted.toFixed(2)}`);
  console.log(`赠送额度已用:                   ¥${used.toFixed(2)}`);
  console.log(`赠送额度剩余:                   ¥${granted.sub(used).toFixed(2)}`);
  console.log(`授权记录数:                     ${grantCount}`);
  console.log(
    `旧 ComputeAccount.balance 合计:  ¥${report.legacyComputeAccountBalance.toFixed(2)}  ⚠️ 已废弃字段，不作为余额`,
  );
  console.log(
    `旧订阅 Token 配额待处理残值:     ${report.legacyQuotaTokensTotal.toLocaleString()} tokens  ⚠️ 不折算，需人工决策`,
  );

  if (report.errors.length > 0) {
    console.log(`\n❌ 错误 ${report.errors.length} 个：`);
    for (const e of report.errors) {
      console.log(`   - ${e.subscriptionId}: ${e.error}`);
    }
  }

  console.log(
    isDryRun
      ? '\n💡 以上为预览结果。确认无误后加 --execute 执行真实迁移。'
      : '\n✅ 迁移完成。重复执行本脚本不会重复赠送。',
  );
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

function banner(isDryRun: boolean) {
  console.log('='.repeat(80));
  console.log('存量订阅 → 人民币赠送余额（SubscriptionCredit）迁移');
  console.log('='.repeat(80));
  console.log(`模式: ${isDryRun ? '🔍 DRY-RUN（预览，不写库）' : '⚠️  EXECUTE（真实写入）'}`);
  console.log();
}

function readNumberFlag(flag: string): number | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const raw = process.argv[index + 1];
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} 需要一个非负数字，收到: ${raw}`);
  }
  return Math.round(value * 100) / 100;
}

/** 读系统设置里的默认赠送金额。缺失或非法一律按 0 —— 迁移不该替运营猜金额。 */
async function readSystemDefaultGiftCNY(): Promise<number> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: 'DEFAULT_EMPLOYEE_GIFT_CNY' },
  });
  const value = Number(row?.value ?? process.env.DEFAULT_EMPLOYEE_GIFT_CNY);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : 0;
}

main().catch((error) => {
  console.error('迁移失败:', error);
  process.exit(1);
});
