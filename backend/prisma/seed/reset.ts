/**
 * 清库：TRUNCATE ... RESTART IDENTITY CASCADE。
 *
 * 为什么不用 `prisma migrate reset` —— 那个会 DROP SCHEMA 并重放全部迁移，
 * 33 个迁移跑一遍要几十秒，而且会连带清掉 _prisma_migrations 历史。
 * 我们只要数据干净，不要动结构。
 *
 * 保留表（不清）：
 *   _prisma_migrations  迁移历史，动了就等于重置数据库
 *   platform_models     运行时从 sub2api 同步而来（见 model.service.ts），
 *                       不是种子数据；清掉后要等下次同步才恢复
 */
import { PrismaClient } from '@prisma/client';

/** 不参与 TRUNCATE 的表名（物理表名，非 Prisma model 名） */
const PRESERVED_TABLES = ['_prisma_migrations', 'platform_models'];

export async function resetDatabase(prisma: PrismaClient): Promise<string[]> {
  // 从 information_schema 取表，而不是硬编码列表 ——
  // 加了新 model 却忘了加进列表，是这类脚本最常见的腐烂方式。
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

  const targets = rows
    .map((r) => r.tablename)
    .filter((t) => !PRESERVED_TABLES.includes(t));

  if (targets.length === 0) return [];

  // 一条语句里列全部表：CASCADE 才不会因外键顺序报错，
  // 同时整个 TRUNCATE 是单个事务，中途失败不会留下半清状态。
  const quoted = targets.map((t) => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  );

  return targets.sort();
}
