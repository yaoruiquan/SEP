/**
 * 只铺常州数易这一家演示租户 —— `pnpm db:seed:shuyi`。
 *
 * 为什么不用 `pnpm db:seed`：整条流水线里的 03-demo-usage 与
 * 07-dashboard-analytics 不幂等（createMany 无唯一键），每跑一次就给
 * 示例科技再堆一份 30 天数据。要单独补这家公司时走这个入口。
 *
 * `--refresh-usage` 先清掉本租户旧的用量三本账再重建，
 * 让 30 天趋势以「今天」收尾。
 */
import { PrismaClient } from '@prisma/client';
import { DEMO_PASSWORD } from './01-accounts';
import { seedShuyiAccounts, SHUYI_PEOPLE } from './08-shuyi-accounts';
import { resetShuyiUsage, seedShuyiBusiness } from './09-shuyi-business';

const prisma = new PrismaClient();

async function main() {
  const accounts = await seedShuyiAccounts(prisma);
  console.log(
    `🏢 ${accounts.enterprise.name}：${accounts.departments.size} 个部门 / ${accounts.members.size} 名成员`,
  );

  if (process.argv.includes('--refresh-usage')) {
    const wiped = await resetShuyiUsage(prisma, accounts);
    console.log(
      `🧹 已清除旧用量：账单 ${wiped.usageRecords} 条 / 流水 ${wiped.transactions} 条 / 会话 ${wiped.sessions} 条`,
    );
  }

  const business = await seedShuyiBusiness(prisma, accounts);
  console.log(
    `🤝 雇佣关系 ${business.subscriptionCount} 个 / 新增授权 ${business.grantCount} 条 / 钱包余额 ¥${business.walletBalanceCNY.toFixed(2)}`,
  );
  console.log(
    business.skippedUsage
      ? '📊 用量数据已存在，跳过（避免重复堆积）'
      : `📊 会话 ${business.sessionCount} 条 / 账单 ${business.usageRecordCount} 条`,
  );
  console.log(
    business.messageCount > 0
      ? `💬 补齐消息 ${business.messageCount} 条（模型分布面板的数据源）`
      : '💬 消息已齐备，无需补写',
  );

  console.log(`\n✅ 密码统一 ${DEMO_PASSWORD}`);
  for (const p of SHUYI_PEOPLE) {
    const role =
      p.role === 'ENTERPRISE_ADMIN'
        ? '企业管理员'
        : p.role === 'DEPT_MANAGER'
          ? '部门负责人'
          : '普通成员';
    console.log(
      `  ${p.name.padEnd(4, '　')} ${p.email.padEnd(24)} ${role.padEnd(6)} ${p.department ?? '—'} · ${p.position}`,
    );
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
