import { Prisma, PrismaClient } from '@prisma/client';
import { planEmployeeDisplayNames } from './employee-display-names';

export async function renameMarketEmployees(prisma: PrismaClient, apply = false) {
  return prisma.$transaction(async tx => {
    if (!apply) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const before = await tx.digitalEmployee.findMany({ orderBy: { id: 'asc' } });
    const changes = planEmployeeDisplayNames(before);
    if (apply) {
      for (const change of changes) {
        const result = await tx.digitalEmployee.updateMany({
          where: { id: change.id, name: change.before, status: 'APPROVED' },
          data: { name: change.after },
        });
        if (result.count !== 1) throw new Error(`员工已变化，回滚本轮改名：${change.id}`);
      }
      const after = await tx.digitalEmployee.findMany({ orderBy: { id: 'asc' } });
      const expected = new Map(changes.map(change => [change.id, change.after]));
      // Check every employee field except the display name and Prisma's update timestamp.
      const stable = (row: typeof before[number]) => {
        const { name, updatedAt, ...fields } = row;
        return JSON.stringify(fields);
      };
      if (before.length !== after.length || after.some((row, index) =>
        row.name !== (expected.get(row.id) ?? before[index].name) || stable(row) !== stable(before[index]))) {
        throw new Error('非名称字段发生变化，回滚本轮改名');
      }
    }
    return { apply, employees: before.length,
      published: before.filter(employee => employee.status === 'APPROVED').length,
      changed: changes.length, changes };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('仅支持 --apply；默认只读预演');
  if (!process.env.DATABASE_URL) process.loadEnvFile('.env');
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error('此脚本仅允许本地数据库；生产改名须走授权发布流程');
  }
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await renameMarketEmployees(prisma, args.includes('--apply')), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
