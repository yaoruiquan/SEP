#!/usr/bin/env tsx
/**
 * Data migration: compute_transactions.metadata.instanceId → subscriptionId
 *
 * 背景：
 * 收敛前，消费记录（ComputeTransaction）的 metadata 存的是 { instanceId, ... }。
 * 收敛后 EmployeeInstance 模型已删除，统计 Top5 按 subscriptionId 聚合。
 *
 * 问题：
 * 生产环境里老的消费行 metadata 仍是旧 key，导致收敛之前的历史数据在
 * Top5 里消失（工作台显示为空，或只统计收敛后的新消费）。
 *
 * 方案：
 * 通过旧的 employee_instances 表（迁移已改名为 subscriptions，但老行的
 * enterpriseId+employeeId 组合仍能定位到唯一的 subscription.id）把老
 * metadata 里的 instanceId 改写为 subscriptionId，保证统计连续性。
 *
 * 运行：
 *   pnpm tsx prisma/migrate-instance-metadata.ts [--dry-run]
 *
 * 安全性：
 *   - 默认 dry-run，需显式传 --commit 才真正写入
 *   - 只改 metadata 有 instanceId 且该 ID 能在 subscriptions 表找到对应行的记录
 *   - 改完后 metadata 同时保留两个 key（instanceId 不删，加 subscriptionId）
 *     以便万一需要回滚时仍有原始数据
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const isDryRun = !process.argv.includes('--commit');
  console.log(`\n=== Migrate compute_transactions.metadata.instanceId → subscriptionId ===`);
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (pass --commit to write)' : 'COMMIT'}\n`);

  // 1. 找出所有 metadata 含 instanceId 的消费记录
  const txs = await prisma.computeTransaction.findMany({
    where: {
      // Prisma 5+ jsonb 查询：path() 存在
      metadata: { path: ['instanceId'], not: null },
    },
    select: {
      id: true,
      metadata: true,
      createdAt: true,
    },
  });

  console.log(`Found ${txs.length} transactions with metadata.instanceId\n`);

  if (txs.length === 0) {
    console.log('Nothing to migrate. Exiting.');
    return;
  }

  // 2. 构建 instanceId → subscriptionId 映射
  //    收敛后，原 employee_instances 表已改名为 subscriptions，且 unique(enterpriseId, employeeId)
  //    老 instance 的 (enterpriseId, employeeId) 现在对应唯一一段 subscription
  const instanceIds = new Set<string>();
  for (const tx of txs) {
    const meta = tx.metadata as any;
    if (meta?.instanceId && typeof meta.instanceId === 'string') {
      instanceIds.add(meta.instanceId);
    }
  }

  console.log(`Distinct instanceIds: ${instanceIds.size}`);

  // 通过 raw query 批量查 old employee_instances (现名 subscriptions) 的 ID
  //   Prisma 迁移后表名是 subscriptions，但老行的 id 字段仍是当年 instance 创建时生成的 CUID
  const rows = await prisma.$queryRaw<Array<{ old_id: string; enterprise_id: string; employee_id: string }>>`
    SELECT id as old_id, "enterpriseId" as enterprise_id, "employeeId" as employee_id
    FROM subscriptions
    WHERE id = ANY(${Array.from(instanceIds)})
  `;

  const instanceToSub = new Map<string, string>();
  for (const row of rows) {
    // 收敛后，subscription.id 就是原来的 instance.id（迁移直接 RENAME TABLE）
    instanceToSub.set(row.old_id, row.old_id);
  }

  console.log(`Matched ${instanceToSub.size} instanceIds to subscriptions\n`);

  if (instanceToSub.size === 0) {
    console.log('No matching subscriptions found. Exiting.');
    return;
  }

  // 3. 批量更新
  let updated = 0;
  let skipped = 0;

  for (const tx of txs) {
    const meta = tx.metadata as any;
    const oldInstanceId = meta?.instanceId;

    if (!oldInstanceId || typeof oldInstanceId !== 'string') {
      skipped++;
      continue;
    }

    const subId = instanceToSub.get(oldInstanceId);
    if (!subId) {
      console.log(`  [SKIP] tx ${tx.id}: instanceId=${oldInstanceId} not found in subscriptions`);
      skipped++;
      continue;
    }

    // 同时保留两个 key，方便回滚
    const newMeta = {
      ...meta,
      subscriptionId: subId,
      // instanceId 不删，以防万一
    };

    if (isDryRun) {
      console.log(`  [DRY] tx ${tx.id}: would add subscriptionId=${subId}`);
    } else {
      await prisma.computeTransaction.update({
        where: { id: tx.id },
        data: { metadata: newMeta },
      });
      console.log(`  [OK]  tx ${tx.id}: added subscriptionId=${subId}`);
    }

    updated++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (no data changed)' : 'COMMIT'}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
