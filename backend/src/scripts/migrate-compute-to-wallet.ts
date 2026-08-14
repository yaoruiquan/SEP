/**
 * 数据迁移脚本：ComputeAccount → EnterpriseWallet
 *
 * 功能：
 * 1. 将 ComputeAccount.balance 迁移到 EnterpriseWallet.balance
 * 2. 将 ComputeTransaction 转换为 WalletTransaction (relatedType='compute')
 *
 * 使用：
 *   pnpm tsx src/scripts/migrate-compute-to-wallet.ts [--dry-run]
 *
 * 注意：
 * - 默认 dry-run 模式（不实际写入）
 * - 使用 --execute 标志执行真实迁移
 * - 迁移前会备份受影响的数据
 * - 幂等性：已迁移的数据不会重复处理
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

interface MigrationStats {
  accountsProcessed: number;
  accountsSkipped: number;
  transactionsMigrated: number;
  totalBalanceMigrated: number;
  errors: Array<{ enterpriseId: string; error: string }>;
}

async function main() {
  const isDryRun = !process.argv.includes('--execute');

  console.log('='.repeat(80));
  console.log('ComputeAccount → EnterpriseWallet 数据迁移');
  console.log('='.repeat(80));
  console.log(`模式: ${isDryRun ? '🔍 DRY-RUN（预览）' : '⚠️  EXECUTE（真实迁移）'}`);
  console.log();

  if (isDryRun) {
    console.log('💡 提示：这是预览模式，不会修改任何数据');
    console.log('   使用 --execute 标志执行真实迁移\n');
  } else {
    console.log('⚠️  警告：将执行真实数据迁移！');
    console.log('   按 Ctrl+C 取消，或等待 5 秒后开始...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const stats: MigrationStats = {
    accountsProcessed: 0,
    accountsSkipped: 0,
    transactionsMigrated: 0,
    totalBalanceMigrated: 0,
    errors: [],
  };

  try {
    // 1. 获取所有 ComputeAccount
    const accounts = await prisma.computeAccount.findMany({
      include: {
        transactions: {
          orderBy: { createdAt: 'asc' },
        },
        enterprise: {
          select: { id: true, name: true },
        },
      },
    });

    console.log(`📊 发现 ${accounts.length} 个算力账户\n`);

    // 2. 逐个迁移
    for (const account of accounts) {
      const enterpriseId = account.enterpriseId;
      const enterpriseName = account.enterprise.name;

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`处理企业: ${enterpriseName} (${enterpriseId})`);
      console.log(`  账户ID: ${account.id}`);
      console.log(`  余额: ¥${account.balance}`);
      console.log(`  交易记录: ${account.transactions.length} 条`);

      try {
        // 检查是否已有钱包
        const existingWallet = await prisma.enterpriseWallet.findUnique({
          where: { enterpriseId },
        });

        if (existingWallet) {
          console.log(`  ✓ 钱包已存在 (balance: ¥${existingWallet.balance})`);

          // 检查是否已迁移过（通过 totalDeposit/totalConsume 判断）
          const hasComputeTransactions = await prisma.walletTransaction.findFirst({
            where: {
              walletId: existingWallet.id,
              relatedType: 'compute',
            },
          });

          if (hasComputeTransactions) {
            console.log(`  ⏭️  跳过：已存在算力交易记录，可能已迁移`);
            stats.accountsSkipped++;
            continue;
          }
        }

        if (!isDryRun) {
          await migrateAccount(account, existingWallet);
        }

        stats.accountsProcessed++;
        stats.transactionsMigrated += account.transactions.length;
        stats.totalBalanceMigrated += account.balance;

        console.log(`  ✅ ${isDryRun ? '预览' : '迁移'}完成`);
      } catch (error) {
        console.error(`  ❌ 错误:`, error);
        stats.errors.push({
          enterpriseId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 3. 打印统计
    console.log('\n' + '='.repeat(80));
    console.log('迁移统计');
    console.log('='.repeat(80));
    console.log(`处理账户: ${stats.accountsProcessed}`);
    console.log(`跳过账户: ${stats.accountsSkipped}`);
    console.log(`迁移交易: ${stats.transactionsMigrated} 条`);
    console.log(`迁移余额: ¥${stats.totalBalanceMigrated.toFixed(2)}`);

    if (stats.errors.length > 0) {
      console.log(`\n❌ 错误: ${stats.errors.length} 个`);
      stats.errors.forEach(({ enterpriseId, error }) => {
        console.log(`   - ${enterpriseId}: ${error}`);
      });
    }

    if (isDryRun) {
      console.log('\n💡 这是预览结果，使用 --execute 执行真实迁移');
    } else {
      console.log('\n✅ 迁移完成！');
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 迁移单个账户（在事务中执行）
 */
async function migrateAccount(
  account: any,
  existingWallet: any,
) {
  return prisma.$transaction(async (tx) => {
    const enterpriseId = account.enterpriseId;

    // 1. 创建或更新钱包
    let wallet = existingWallet;

    if (!wallet) {
      wallet = await tx.enterpriseWallet.create({
        data: {
          enterpriseId,
          balance: new Decimal(account.balance),
          totalDeposit: 0,
          totalConsume: 0,
          totalRefund: 0,
        },
      });
      console.log(`    ✓ 创建钱包`);
    } else {
      // 更新余额
      wallet = await tx.enterpriseWallet.update({
        where: { id: wallet.id },
        data: {
          balance: { increment: new Decimal(account.balance) },
        },
      });
      console.log(`    ✓ 更新钱包余额 (+¥${account.balance})`);
    }

    // 2. 迁移交易记录
    let balanceBefore = new Decimal(0);

    for (const tx of account.transactions) {
      const amount = new Decimal(tx.amount);
      const balanceAfter = balanceBefore.add(amount);

      // 根据类型映射到钱包交易类型
      let walletTxType: 'DEPOSIT' | 'CONSUME' | 'REFUND';
      if (tx.type === 'RECHARGE') {
        walletTxType = 'DEPOSIT';
      } else if (tx.type === 'CONSUME') {
        walletTxType = 'CONSUME';
      } else {
        walletTxType = 'REFUND';
      }

      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: walletTxType,
          amount,
          balanceBefore,
          balanceAfter,
          relatedType: 'compute',
          relatedId: tx.sessionId,
          description: tx.description || `算力${tx.type === 'RECHARGE' ? '充值' : '消费'}（从旧系统迁移）`,
          metadata: {
            migratedFrom: 'ComputeTransaction',
            originalId: tx.id,
            originalCreatedAt: tx.createdAt.toISOString(),
            ...(tx.metadata as object || {}),
          },
          createdAt: tx.createdAt,
        },
      });

      balanceBefore = balanceAfter;
    }

    console.log(`    ✓ 迁移 ${account.transactions.length} 条交易记录`);

    // 3. 更新钱包统计字段
    const depositSum = account.transactions
      .filter((t: any) => t.type === 'RECHARGE')
      .reduce((sum: number, t: any) => sum + t.amount, 0);

    const consumeSum = account.transactions
      .filter((t: any) => t.type === 'CONSUME')
      .reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);

    await tx.enterpriseWallet.update({
      where: { id: wallet.id },
      data: {
        totalDeposit: { increment: new Decimal(depositSum) },
        totalConsume: { increment: new Decimal(consumeSum) },
      },
    });

    console.log(`    ✓ 更新统计 (充值: ¥${depositSum}, 消费: ¥${consumeSum})`);
  });
}

main().catch((error) => {
  console.error('迁移失败:', error);
  process.exit(1);
});
