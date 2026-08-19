#!/usr/bin/env ts-node
/**
 * 从 agency-agents 仓库导入数字员工和技能
 *
 * 用法：
 *   pnpm tsx scripts/import-agency-agents.ts --count 30
 *   pnpm tsx scripts/import-agency-agents.ts --divisions engineering,marketing,sales
 */

import { PrismaClient, EmployeeStatus, CapabilityType, CapabilityStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

const prisma = new PrismaClient();

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
  } catch (error) {
    console.error(`❌ 解析失败 ${filePath}:`, error);
    return null;
  }
}

/**
 * 扫描指定部门的所有 agent 文件
 */
function scanAgents(agencyRepoPath: string, divisions: string[]): ParsedAgent[] {
  const agents: ParsedAgent[] = [];

  for (const division of divisions) {
    const divisionPath = path.join(agencyRepoPath, division);

    if (!fs.existsSync(divisionPath)) {
      console.warn(`⚠️  部门目录不存在: ${divisionPath}`);
      continue;
    }

    const files = fs.readdirSync(divisionPath)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(divisionPath, f));

    for (const filePath of files) {
      const agent = parseAgentFile(filePath, division);
      if (agent) {
        agents.push(agent);
      }
    }
  }

  return agents;
}

/**
 * 提取 agent 的系统提示词（从 Identity & Memory 和 Core Mission 部分）
 */
function extractSystemPrompt(content: string, frontmatter: AgentFrontmatter): string {
  // 提取 Identity & Memory 部分
  const identityMatch = content.match(/## .*Identity.*?\n([\s\S]*?)(?=\n##|$)/i);
  const missionMatch = content.match(/## .*Core Mission.*?\n([\s\S]*?)(?=\n##|$)/i);

  let prompt = `You are ${frontmatter.name}. ${frontmatter.description}\n\n`;

  if (identityMatch) {
    prompt += identityMatch[1].trim() + '\n\n';
  }

  if (missionMatch) {
    prompt += '## Your Core Mission\n' + missionMatch[1].trim();
  }

  // 限制长度
  return prompt.slice(0, 2000);
}

/**
 * 从 agent 内容中提取技能点（Capabilities）
 */
function extractCapabilities(agent: ParsedAgent): Array<{
  name: string;
  description: string;
  template: string;
}> {
  const capabilities: Array<{ name: string; description: string; template: string }> = [];

  // 从 Core Mission 部分提取主要能力
  const missionMatch = agent.content.match(/## .*Core Mission.*?\n([\s\S]*?)(?=\n##|$)/i);

  if (missionMatch) {
    const missions = missionMatch[1].split('\n###').filter(m => m.trim());

    for (const mission of missions.slice(0, 5)) { // 最多5个能力
      const lines = mission.trim().split('\n');
      const title = lines[0].replace(/^#+\s*/, '').trim();
      const desc = lines.slice(1).join('\n').trim().slice(0, 300);

      if (title && desc) {
        capabilities.push({
          name: title,
          description: desc,
          template: `You are ${agent.frontmatter.name}, focused on: ${title}\n\n${desc}\n\n请根据用户需求完成任务。`,
        });
      }
    }
  }

  // 如果没提取到，创建一个默认能力
  if (capabilities.length === 0) {
    capabilities.push({
      name: `${agent.frontmatter.name} Core Skill`,
      description: agent.frontmatter.description,
      template: `You are ${agent.frontmatter.name}. ${agent.frontmatter.description}\n\n请根据用户需求完成任务。`,
    });
  }

  return capabilities;
}

/**
 * 导入单个 agent 到数据库
 */
async function importAgent(agent: ParsedAgent, contributorId: string): Promise<void> {
  console.log(`\n📦 导入: ${agent.frontmatter.name} (${agent.division})`);

  // 1. 创建 DigitalEmployee
  const systemPrompt = extractSystemPrompt(agent.content, agent.frontmatter);
  const avatar = `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(agent.slug)}`;

  const employee = await prisma.digitalEmployee.create({
    data: {
      name: agent.frontmatter.name,
      description: agent.frontmatter.description,
      industry: agent.division.replace(/-/g, ' '),
      position: agent.frontmatter.name,
      avatar,
      systemPrompt,
      modelId: 'gpt-4o',
      maxSteps: 10,
      status: EmployeeStatus.APPROVED,
      version: '1.0.0',
      annualPriceCNY: 30000, // 默认3万/年
      includedComputeCNY: 6000, // 20%算力
      publishedAt: new Date(),
    },
  });

  console.log(`  ✅ 员工已创建: ${employee.id}`);

  // 2. 创建 Capabilities 并绑定
  const capabilities = extractCapabilities(agent);

  for (const [index, cap] of capabilities.entries()) {
    const capability = await prisma.capability.create({
      data: {
        name: cap.name,
        description: cap.description,
        type: CapabilityType.SKILL,
        industry: [agent.division.replace(/-/g, ' ')],
        position: [agent.frontmatter.name],
        inputSchema: {},
        outputSchema: {},
        contributorId,
        status: CapabilityStatus.APPROVED,
        approvedAt: new Date(),
        skillConfig: {
          create: {
            template: cap.template,
            modelId: 'gpt-4o-mini',
            temperature: 0.7,
            maxTokens: 2000,
          },
        },
      },
    });

    // 绑定到员工
    await prisma.employeeCapabilityBinding.create({
      data: {
        employeeId: employee.id,
        capabilityId: capability.id,
        priority: (capabilities.length - index) * 10, // 优先级递减
        enabled: true,
      },
    });

    console.log(`  ✅ 技能已绑定: ${cap.name}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const countArg = args.find(a => a.startsWith('--count='));
  const divisionsArg = args.find(a => a.startsWith('--divisions='));

  const targetCount = countArg ? parseInt(countArg.split('=')[1]) : 30;
  const targetDivisions = divisionsArg
    ? divisionsArg.split('=')[1].split(',')
    : ['engineering', 'marketing', 'sales', 'design', 'product'];

  const agencyRepoPath = '/tmp/agency-agents';

  if (!fs.existsSync(agencyRepoPath)) {
    console.error('❌ agency-agents 仓库不存在于 /tmp/agency-agents');
    console.error('   请先克隆: cd /tmp && git clone https://github.com/msitarzewski/agency-agents.git');
    process.exit(1);
  }

  console.log(`🚀 开始导入 agency-agents...`);
  console.log(`   目标数量: ${targetCount} 个员工`);
  console.log(`   目标部门: ${targetDivisions.join(', ')}`);

  // 扫描 agents
  const agents = scanAgents(agencyRepoPath, targetDivisions);
  console.log(`\n📊 扫描到 ${agents.length} 个 agent`);

  // 限制数量
  const selectedAgents = agents.slice(0, targetCount);

  // 获取贡献者（使用平台管理员账号）
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!admin) {
    console.error('❌ 未找到平台管理员账号，请先运行 seed 脚本');
    process.exit(1);
  }

  console.log(`\n🔄 开始导入 ${selectedAgents.length} 个员工...\n`);

  for (const agent of selectedAgents) {
    await importAgent(agent, admin.id);
  }

  console.log(`\n✅ 导入完成！共导入 ${selectedAgents.length} 个数字员工`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
