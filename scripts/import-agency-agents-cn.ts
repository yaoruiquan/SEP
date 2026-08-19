#!/usr/bin/env tsx
/**
 * 从 agency-agents 仓库导入数字员工和技能（中文版）
 *
 * 特性：
 * 1. 所有前端可见字段翻译为中文
 * 2. 技能共享：一个技能可以被多个员工绑定
 * 3. 员工多技能：一个员工可以绑定多个技能
 *
 * 用法：
 *   pnpm tsx scripts/import-agency-agents-cn.ts --count 30
 *   pnpm tsx scripts/import-agency-agents-cn.ts --divisions engineering,marketing,sales
 */

import { PrismaClient, CapabilityType, CapabilityStatus, EmployeeStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

const prisma = new PrismaClient();

// 部门中英文映射
const DIVISION_CN_MAP: Record<string, string> = {
  'engineering': '工程技术',
  'marketing': '市场营销',
  'sales': '销售',
  'design': '设计',
  'product': '产品',
  'support': '客户支持',
  'testing': '质量测试',
  'security': '安全',
  'finance': '财务',
  'specialized': '专业服务',
  'operations': '运营',
  'hr': '人力资源',
  'legal': '法务',
  'data': '数据分析',
  'content': '内容创作',
  'education': '教育培训',
  'research': '研究开发',
  'game-development': '游戏开发',
  'healthcare': '医疗健康',
  'real-estate': '房地产',
  'other': '其他',
};

interface AgentFrontmatter {
  name: string;
  description: string;
  tools?: string;
  color?: string;
  emoji?: string;
  vibe?: string;
}

interface ParsedAgent {
  frontmatter: AgentFrontmatter;
  content: string;
  filePath: string;
  division: string;
  slug: string;
}

/**
 * 解析单个 agent markdown 文件
 */
function parseAgentFile(filePath: string, division: string): ParsedAgent | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: body } = matter(content);

    if (!data.name || !data.description) {
      console.warn(`⚠️  跳过 ${filePath}：缺少 name 或 description`);
      return null;
    }

    const slug = path.basename(filePath, '.md');

    return {
      frontmatter: data as AgentFrontmatter,
      content: body,
      filePath,
      division,
      slug,
    };
  } catch (error: any) {
    console.error(`❌ 解析失败 ${filePath}:`, error.message);
    return null;
  }
}

/**
 * 扫描 agency-agents 仓库
 */
function scanAgencyAgentsRepo(
  repoPath: string,
  targetDivisions?: string[]
): ParsedAgent[] {
  const agents: ParsedAgent[] = [];

  if (!fs.existsSync(repoPath)) {
    console.error(`❌ 仓库路径不存在: ${repoPath}`);
    return agents;
  }

  const divisions = fs.readdirSync(repoPath).filter((item) => {
    const itemPath = path.join(repoPath, item);
    return fs.statSync(itemPath).isDirectory();
  });

  for (const division of divisions) {
    // 过滤部门
    if (targetDivisions && !targetDivisions.includes(division)) {
      continue;
    }

    const divisionPath = path.join(repoPath, division);
    const files = fs.readdirSync(divisionPath).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(divisionPath, file);
      const parsed = parseAgentFile(filePath, division);
      if (parsed) {
        agents.push(parsed);
      }
    }
  }

  return agents;
}

/**
 * 从 agent 内容中提取技能点（优化版：简洁的中文技能名）
 */
function extractCapabilities(agent: ParsedAgent): Array<{ name: string; prompt: string }> {
  const capabilities: Array<{ name: string; prompt: string }> = [];

  // 基础技能名映射
  const skillNameMap: Record<string, string> = {
    'Frontend Developer': '前端开发',
    'Backend Architect': '后端架构设计',
    'API Platform Engineer': '合约优先API设计',
    'Database Optimizer': '数据库优化',
    'DevOps Automator': 'DevOps自动化',
    'Security Architect': '安全架构',
    'Test Automation Engineer': '测试自动化',
    'Code Reviewer': '代码审查',
    'Data Engineer': '数据工程',
    'AI Engineer': 'AI工程',
  };

  // 从 frontmatter.name 生成默认技能名
  const defaultSkillName = skillNameMap[agent.frontmatter.name] ||
    agent.frontmatter.name.replace(/Engineer|Developer|Architect|Specialist/gi, '').trim() ||
    agent.frontmatter.name;

  // 从 content 中提取关键能力点
  const lines = agent.content.split('\n');
  const keyCapabilities: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 提取技术交付物 (## Technical Deliverables 部分)
    if (trimmed.startsWith('- ') && trimmed.length > 50 && trimmed.length < 200) {
      keyCapabilities.push(trimmed.substring(2));
    }

    // 提取核心任务 (## Core Mission 部分的要点)
    if (trimmed.startsWith('## Core Mission')) {
      // 在这一节下寻找关键任务
      continue;
    }
  }

  // 如果提取到了关键能力，创建多个技能
  if (keyCapabilities.length > 0) {
    // 取前 3 个最重要的能力点
    for (let i = 0; i < Math.min(3, keyCapabilities.length); i++) {
      const cap = keyCapabilities[i];

      // 生成简洁的技能名
      let skillName = '';
      if (cap.includes(':')) {
        // "Design contract-first: the OpenAPI..." -> "合约优先API设计"
        skillName = cap.split(':')[0].trim();
      } else {
        // 取第一句话或前 30 个字符
        skillName = cap.split('.')[0].substring(0, 50).trim();
      }

      capabilities.push({
        name: `${defaultSkillName} - ${skillName}`,
        prompt: `${agent.frontmatter.description}\n\n核心能力：${cap}\n\n${agent.content.substring(0, 500)}`,
      });
    }
  }

  // 如果没有提取到，创建一个默认技能
  if (capabilities.length === 0) {
    capabilities.push({
      name: `${defaultSkillName}核心技能`,
      prompt: `${agent.frontmatter.description}\n\n${agent.content.substring(0, 500)}`,
    });
  }

  return capabilities;
}

/**
 * 导入单个数字员工和技能
 */
async function importAgent(agent: ParsedAgent, skillsCache: Map<string, string>, defaultContributorId: string) {
  const { frontmatter, content, division } = agent;

  // 提取 systemPrompt (Identity & Memory + Core Mission)
  const identityMatch = content.match(/## Identity & Memory\n([\s\S]*?)(?=\n##|$)/);
  const missionMatch = content.match(/## Core Mission\n([\s\S]*?)(?=\n##|$)/);

  const systemPrompt = `${identityMatch?.[1] || ''}\n\n${missionMatch?.[1] || ''}`.trim() ||
    content.substring(0, 1000);

  // 翻译职位名称（简化处理）
  const positionCn = frontmatter.name
    .replace(/Engineer/gi, '工程师')
    .replace(/Developer/gi, '开发者')
    .replace(/Architect/gi, '架构师')
    .replace(/Specialist/gi, '专家')
    .replace(/Manager/gi, '经理')
    .replace(/Lead/gi, '负责人')
    .replace(/Senior/gi, '高级')
    .replace(/Junior/gi, '初级');

  // 创建数字员工
  const employee = await prisma.digitalEmployee.create({
    data: {
      name: positionCn,
      description: frontmatter.description,
      position: positionCn,
      industry: DIVISION_CN_MAP[division] || division,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${agent.slug}`,
      modelId: 'gpt-4o-mini',
      systemPrompt,
      annualPriceCNY: 30000,
      includedComputeCNY: 6000,
      status: EmployeeStatus.APPROVED,
    },
  });

  console.log(`\n📦 导入: ${positionCn} (${DIVISION_CN_MAP[division] || division})`);
  console.log(`  ✅ 员工已创建: ${employee.id}`);

  // 提取技能并创建/复用
  const capabilitiesToBind = extractCapabilities(agent);

  for (const cap of capabilitiesToBind) {
    let capabilityId: string;

    // 检查技能是否已存在（支持技能共享）
    if (skillsCache.has(cap.name)) {
      capabilityId = skillsCache.get(cap.name)!;
      console.log(`  🔗 复用技能: ${cap.name}`);
    } else {
      // 创建新技能
      const capability = await prisma.capability.create({
        data: {
          name: cap.name,
          description: `${positionCn}的核心技能`,
          type: CapabilityType.SKILL,
          status: CapabilityStatus.APPROVED,
          contributorId: defaultContributorId,
          industry: [DIVISION_CN_MAP[division] || division],
          position: [positionCn],
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '用户输入' }
            },
            required: ['query']
          },
          outputSchema: {
            type: 'object',
            properties: {
              result: { type: 'string', description: '执行结果' }
            }
          },
          skillConfig: {
            create: {
              template: cap.prompt,
              modelId: 'gpt-4o-mini',
              temperature: 0.7,
              maxTokens: 2000,
            },
          },
        },
      });

      capabilityId = capability.id;
      skillsCache.set(cap.name, capabilityId);
      console.log(`  ✅ 技能已创建: ${cap.name}`);
    }

    // 绑定技能到员工
    await prisma.employeeCapabilityBinding.create({
      data: {
        employeeId: employee.id,
        capabilityId,
        priority: 50,  // 默认优先级
        enabled: true,
      },
    });
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const countArg = args.find((arg) => arg.startsWith('--count'));
  const divisionsArg = args.find((arg) => arg.startsWith('--divisions'));

  const targetCount = countArg ? parseInt(countArg.split('=')[1] || '30') : 30;
  const targetDivisions = divisionsArg
    ? divisionsArg.split('=')[1].split(',')
    : undefined;

  const repoPath = '/tmp/agency-agents';

  console.log('🚀 开始导入 agency-agents（中文版）...');
  console.log(`   目标数量: ${targetCount} 个员工`);
  if (targetDivisions) {
    console.log(`   目标部门: ${targetDivisions.join(', ')}`);
  }

  // 获取或创建默认贡献者（任意管理员或系统导入账号）
  let defaultContributor = await prisma.user.findFirst({
    where: {
      OR: [
        { email: 'admin@example.com' },
        { email: 'system-import@sep.local' },
        { role: 'ADMIN' }
      ]
    }
  });

  if (!defaultContributor) {
    console.log('⚠️  未找到管理员，创建系统导入账号...');
    defaultContributor = await prisma.user.create({
      data: {
        email: 'system-import@sep.local',
        password: '$2b$10$placeholder',  // bcrypt placeholder，此账号不用于登录
        name: '系统导入',
        role: 'ADMIN',
      }
    });
  }

  console.log(`   贡献者: ${defaultContributor.email} (${defaultContributor.id})\n`);

  // 扫描仓库
  const agents = scanAgencyAgentsRepo(repoPath, targetDivisions);
  console.log(`\n📊 扫描到 ${agents.length} 个 agent\n`);

  if (agents.length === 0) {
    console.error('❌ 没有找到符合条件的 agent');
    return;
  }

  // 限制数量
  const agentsToImport = agents.slice(0, targetCount);
  console.log(`🔄 开始导入 ${agentsToImport.length} 个员工...\n`);

  // 技能缓存（支持技能共享）
  const skillsCache = new Map<string, string>();

  for (const agent of agentsToImport) {
    try {
      await importAgent(agent, skillsCache, defaultContributor.id);
    } catch (error: any) {
      console.error(`❌ 导入失败 ${agent.frontmatter.name}:`, error.message);
    }
  }

  console.log(`\n✅ 导入完成！`);
  console.log(`   员工数: ${agentsToImport.length}`);
  console.log(`   技能数: ${skillsCache.size} (共享)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
