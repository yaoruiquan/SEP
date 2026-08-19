/**
 * 03-import-50-employees.ts - 从 agency-agents 仓库导入 50 个数字员工
 *
 * 流程：
 * 1. 读取员工配置（employees-config.ts）
 * 2. 对于每个员工绑定的技能：
 *    - 解析技能 Markdown 文件
 *    - 创建 Capability (type=SKILL)
 * 3. 创建 DigitalEmployee
 * 4. 创建绑定关系 EmployeeCapabilityBinding
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { EMPLOYEES } from './employees-config';

const prisma = new PrismaClient();

interface SkillMetadata {
  name: string;
  description: string;
  emoji?: string;
  color?: string;
  vibe?: string;
}

interface ParsedSkill {
  metadata: SkillMetadata;
  content: string;
  filepath: string;
}

/**
 * 解析单个技能 Markdown 文件
 */
function parseSkillFile(filepath: string): ParsedSkill | null {
  const fullPath = path.join(process.env.HOME!, '.agency-agents', filepath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`    ⚠️  技能文件不存在: ${filepath}`);
    return null;
  }

  const fileContent = fs.readFileSync(fullPath, 'utf-8');
  const parsed = matter(fileContent);

  const metadata = parsed.data as SkillMetadata;
  const content = parsed.content;

  // 验证必需字段
  if (!metadata.name || !metadata.description) {
    console.warn(`    ⚠️  技能缺少必需字段: ${filepath}`);
    return null;
  }

  return {
    metadata,
    content,
    filepath,
  };
}

async function main() {
  console.log('🚀 开始导入 50 个数字员工...\n');
  console.log(`📋 员工总数: ${EMPLOYEES.length}`);
  console.log('');

  // 获取第一个用户作为 contributor
  const systemUser = await prisma.user.findFirst();
  if (!systemUser) {
    throw new Error('数据库中没有用户，请先运行种子数据脚本创建用户');
  }
  console.log(`👤 使用系统用户: ${systemUser.email} (${systemUser.id})\n`);

  let successCount = 0;
  let failCount = 0;
  const skillCache = new Map<string, string>(); // filepath → capabilityId 缓存，避免重复创建

  for (const employeeConfig of EMPLOYEES) {
    try {
      console.log(`👤 [${successCount + 1}/${EMPLOYEES.length}] ${employeeConfig.name} - ${employeeConfig.title}`);

      // 1. 处理该员工的所有技能
      const capabilityIds: string[] = [];

      for (const skillPath of employeeConfig.skills) {
        // 检查缓存，避免重复创建相同技能
        if (skillCache.has(skillPath)) {
          const cachedId = skillCache.get(skillPath)!;
          capabilityIds.push(cachedId);
          console.log(`    🔗 复用技能: ${skillPath}`);
          continue;
        }

        // 解析技能文件
        const parsed = parseSkillFile(skillPath);
        if (!parsed) {
          console.warn(`    ⚠️  跳过无效技能: ${skillPath}`);
          continue;
        }

        const { metadata, content } = parsed;

        // 创建 Capability
        const capability = await prisma.capability.create({
          data: {
            name: metadata.name,
            description: metadata.description,
            type: 'SKILL',
            industry: [], // 通用技能，不限行业
            position: [], // 通用技能，不限岗位
            inputSchema: {}, // 技能暂无输入 schema
            outputSchema: {}, // 技能暂无输出 schema
            contributorId: systemUser.id, // 使用系统用户
            status: 'APPROVED', // 自动审核通过
            skillConfig: {
              create: {
                template: content, // 完整的 Markdown 内容
              },
            },
          },
        });

        capabilityIds.push(capability.id);
        skillCache.set(skillPath, capability.id);
        console.log(`    ✅ 创建技能: ${metadata.name} (${metadata.emoji || '📦'})`);
      }

      if (capabilityIds.length === 0) {
        console.warn(`    ⚠️  该员工没有有效技能，跳过\n`);
        failCount++;
        continue;
      }

      // 2. 创建 DigitalEmployee
      const employee = await prisma.digitalEmployee.create({
        data: {
          name: employeeConfig.name,
          description: employeeConfig.bio,
          industry: '通用', // 通用行业
          position: employeeConfig.title,
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(employeeConfig.name)}&background=random`,
          systemPrompt: `你是${employeeConfig.name}，一位${employeeConfig.title}。${employeeConfig.bio}`,
          status: 'APPROVED',
          annualPriceCNY: employeeConfig.monthlyPrice * 12, // 月价转年价
        },
      });

      // 3. 创建绑定关系
      for (const capabilityId of capabilityIds) {
        await prisma.employeeCapabilityBinding.create({
          data: {
            employeeId: employee.id,
            capabilityId: capabilityId,
            priority: 100, // 核心能力，最高优先级
            enabled: true,
          },
        });
      }

      console.log(`    ✅ 员工创建成功，绑定 ${capabilityIds.length} 个技能\n`);
      successCount++;
    } catch (error) {
      console.error(`    ❌ 创建失败: ${employeeConfig.name}`);
      console.error(`       ${error}\n`);
      failCount++;
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ 导入完成!`);
  console.log(`   成功: ${successCount} 个员工`);
  console.log(`   失败: ${failCount} 个员工`);
  console.log(`   技能库: ${skillCache.size} 个独立技能`);
  console.log(`   总计: ${EMPLOYEES.length} 个员工配置`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('❌ 导入失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
