/**
 * 演示数据种子 —— 统一入口。
 *
 * 历史包袱：这里曾有 9 个互相冲突的脚本（seed.ts / seed-demo.ts /
 * seed-boss-demo.ts / seed-departments-and-dashboard.ts / ...），
 * 抢同一批邮箱、企业名不一致、依赖彼此的执行顺序。2026-08 全部删除，
 * 收敛到本目录。**不要再往 prisma/ 根目录扔新的 seed-xxx.ts。**
 *
 * 用法：
 *   pnpm db:seed              追加/幂等写入（不清库）
 *
 * 注意：目录同步只管理精选技能员工，不执行清库；现有员工和业务数据必须保留。
 */
import { PrismaClient } from '@prisma/client';
import { resetDatabase } from './reset';
import { seedSettings } from './00-settings';
import { seedAccounts, DEMO_PASSWORD } from './01-accounts';
import { seedCatalog } from './02-catalog';
import { seedDemoUsage } from './03-demo-usage';
import { seedDashboardAnalytics } from './07-dashboard-analytics';
import { seedShuyiAccounts, SHUYI_PEOPLE } from './08-shuyi-accounts';
import { seedShuyiBusiness } from './09-shuyi-business';

const prisma = new PrismaClient();

async function main() {
  const shouldReset = process.argv.includes('--reset');

  if (shouldReset) {
    console.log('🧹 清库中（保留 _prisma_migrations / platform_models）...');
    const cleared = await resetDatabase(prisma);
    console.log(`   已清空 ${cleared.length} 张表\n`);
  }

  const settingCount = await seedSettings(prisma);
  console.log(`⚙️  系统设置：${settingCount} 项`);

  const accounts = await seedAccounts(prisma);
  console.log(
    `👥 账号：2 家企业 / ${accounts.acmeDepartments.size} 个部门 / 5 个用户`,
  );

  const catalog = await seedCatalog(prisma, accounts.platformAdmin.id);
  const statusCounts = catalog.employees.reduce(
    (acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log(
    `🤖 数字员工：${catalog.employees.length} 个（${Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(' / ')}）`,
  );
  if (catalog.unmappedHistoricalEmployees.length > 0) {
    console.warn(`⚠️  未回填业务职能的历史员工：${catalog.unmappedHistoricalEmployees.join('、')}`);
  }

  const usage = await seedDemoUsage(prisma);
  console.log(
    `📊 演示数据：${usage.transactionCount} 条消费记录`,
  );

  await seedDashboardAnalytics();

  // 常州数易 —— 真名演示租户。放在最后：它要挑已上架的员工模板来雇佣，
  // 必须等 02-catalog 铺完目录。
  const shuyi = await seedShuyiAccounts(prisma);
  const shuyiBusiness = await seedShuyiBusiness(prisma, shuyi);
  console.log(
    `🏢 ${shuyi.enterprise.name}：${shuyi.departments.size} 个部门 / ` +
      `${shuyi.members.size} 名成员 / ${shuyiBusiness.subscriptionCount} 个雇佣关系` +
      (shuyiBusiness.skippedUsage ? '（用量数据已存在，跳过）' : ''),
  );

  // TODO(演示数据): 业务数据模块待落地，规模与场景待确认。
  //   04-quota · 06-knowledge · 07-ops（公告+审批流）

  console.log(`\n✅ Seed done. 密码统一 ${DEMO_PASSWORD}\n`);
  console.log('  平台运营  admin@sep.local       不属于任何企业');
  console.log('  甲·管理员 boss@acme.local       示例科技有限公司');
  console.log('  甲·部门长 dev@acme.local        技术部');
  console.log('  甲·成员   staff@acme.local      技术部/研发组');
  console.log('  乙·管理员 boss@globex.local     另一家公司（越权对照）');
  console.log(`\n  ${shuyi.enterprise.name}`);
  for (const person of SHUYI_PEOPLE) {
    console.log(
      `  ${person.name.padEnd(4, '　')} ${person.email.padEnd(24)} ` +
        `${person.position}${person.department ? ` · ${person.department}` : ''}`,
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
