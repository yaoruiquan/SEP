#!/usr/bin/env tsx
/**
 * 检查导入状态
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 数据库统计\n');

  // 统计员工
  const employeeStats = await prisma.digitalEmployee.groupBy({
    by: ['status'],
    _count: true,
  });

  console.log('数字员工：');
  for (const stat of employeeStats) {
    console.log(`  ${stat.status}: ${stat._count} 个`);
  }

  // 统计技能
  const capabilityStats = await prisma.capability.groupBy({
    by: ['status', 'type'],
    _count: true,
  });

  console.log('\n硅基能力：');
  for (const stat of capabilityStats) {
    console.log(`  ${stat.type} / ${stat.status}: ${stat._count} 个`);
  }

  // 统计绑定关系
  const bindingCount = await prisma.employeeCapabilityBinding.count();
  console.log(`\n绑定关系：${bindingCount} 条`);

  // 按行业统计
  const employees = await prisma.digitalEmployee.findMany({
    where: { status: 'APPROVED' },
    select: { industry: true },
  });

  const industryMap = new Map<string, number>();
  for (const emp of employees) {
    industryMap.set(emp.industry, (industryMap.get(emp.industry) || 0) + 1);
  }

  console.log('\n按行业分布：');
  for (const [industry, count] of Array.from(industryMap.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${industry}: ${count} 个`);
  }

  // 显示一些示例员工及其技能
  console.log('\n示例员工及技能：');
  const sampleEmployees = await prisma.digitalEmployee.findMany({
    where: { status: 'APPROVED' },
    take: 5,
    include: {
      bindings: {
        include: {
          capability: {
            select: { name: true, type: true },
          },
        },
      },
    },
  });

  for (const emp of sampleEmployees) {
    console.log(`\n  📦 ${emp.name} (${emp.industry})`);
    for (const binding of emp.bindings) {
      console.log(`     ✅ ${binding.capability.name} [${binding.capability.type}]`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
