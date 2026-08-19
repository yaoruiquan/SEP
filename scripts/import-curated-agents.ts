#!/usr/bin/env tsx
/**
 * 精选导入：从 agency-agents 精选 20-30 个高质量员工
 *
 * 特性：
 * 1. 员工数量 < 技能数量（一员工多技能）
 * 2. 中文翻译（AI 辅助）
 * 3. 完整保留 markdown 作为技能模板
 * 4. 不固定模型（跟随会话默认模型）
 *
 * 用法：
 *   pnpm tsx scripts/import-curated-agents.ts
 */

import { PrismaClient, CapabilityType, CapabilityStatus, EmployeeStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

const prisma = new PrismaClient();

// 精选的 agent 列表（20 个高质量员工）
const CURATED_AGENTS = [
  { file: 'engineering/engineering-ai-engineer.md', name_cn: 'AI 工程师', industry_cn: '工程技术' },
  { file: 'engineering/engineering-backend-architect.md', name_cn: '后端架构师', industry_cn: '工程技术' },
  { file: 'engineering/engineering-frontend-developer.md', name_cn: '前端开发工程师', industry_cn: '工程技术' },
  { file: 'engineering/engineering-mobile-app-builder.md', name_cn: '移动应用开发工程师', industry_cn: '工程技术' },
  { file: 'engineering/engineering-devops-automator.md', name_cn: 'DevOps 自动化工程师', industry_cn: '工程技术' },
  { file: 'engineering/engineering-data-engineer.md', name_cn: '数据工程师', industry_cn: '工程技术' },
  { file: 'design/design-ux-researcher.md', name_cn: 'UX 研究员', industry_cn: '设计' },
  { file: 'design/design-ui-designer.md', name_cn: 'UI 设计师', industry_cn: '设计' },
  { file: 'design/design-visual-storyteller.md', name_cn: '视觉故事设计师', industry_cn: '设计' },
  { file: 'design/design-ux-architect.md', name_cn: 'UX 架构师', industry_cn: '设计' },
  { file: 'marketing/marketing-content-creator.md', name_cn: '内容创作者', industry_cn: '市场营销' },
  { file: 'marketing/marketing-growth-hacker.md', name_cn: '增长黑客', industry_cn: '市场营销' },
  { file: 'marketing/marketing-email-strategist.md', name_cn: '邮件营销策略师', industry_cn: '市场营销' },
  { file: 'sales/sales-account-strategist.md', name_cn: '客户策略经理', industry_cn: '销售' },
  { file: 'sales/sales-proposal-strategist.md', name_cn: '商务提案策略专家', industry_cn: '销售' },
  { file: 'sales/sales-engineer.md', name_cn: '销售工程师', industry_cn: '销售' },
  { file: 'product/product-manager.md', name_cn: '产品经理', industry_cn: '产品' },
  { file: 'product/product-feedback-synthesizer.md', name_cn: '产品反馈分析师', industry_cn: '产品' },
  { file: 'finance/finance-financial-analyst.md', name_cn: '财务分析师', industry_cn: '财务' },
  { file: 'finance/finance-fpa-analyst.md', name_cn: '财务规划分析师', industry_cn: '财务' },
];

// 手工翻译的高质量中文简介
const DESCRIPTION_TRANSLATIONS: Record<string, string> = {
  'engineering-ai-engineer.md': '专业AI工程师，擅长机器学习、深度学习和AI系统开发，将前沿AI技术应用于实际业务场景。',
  'engineering-backend-architect.md': '后端架构师，精通系统架构设计、微服务和高并发系统，构建稳定可扩展的后端服务。',
  'engineering-frontend-developer.md': '前端开发工程师，精通现代Web技术栈，专注于构建高性能、用户体验优秀的前端应用。',
  'engineering-mobile-app-builder.md': '移动应用开发工程师，精通iOS/Android开发，打造流畅的移动端用户体验。',
  'engineering-devops-automator.md': 'DevOps自动化工程师，专注于CI/CD流程优化、容器化部署和云基础设施管理。',
  'engineering-data-engineer.md': '数据工程师，擅长数据管道构建、ETL流程和大数据处理，为数据分析提供稳定基础。',
  'design-ux-researcher.md': 'UX研究员，专注于用户研究、可用性测试和数据驱动的设计决策，提升产品用户体验。',
  'design-ui-designer.md': 'UI设计师，精通界面设计、视觉规范和设计系统，创造美观易用的产品界面。',
  'design-visual-storyteller.md': '视觉叙事专家，擅长通过设计将复杂信息转化为引人入胜的视觉故事，提升品牌影响力。',
  'design-ux-architect.md': 'UX架构师，负责整体用户体验架构设计，确保产品体验的一致性和可扩展性。',
  'marketing-content-creator.md': '内容创作者，精通内容策划、文案撰写和多渠道内容营销，提升品牌传播效果。',
  'marketing-growth-hacker.md': '增长黑客，擅长数据驱动的用户增长策略，通过实验和优化实现业务快速增长。',
  'marketing-email-strategist.md': '邮件营销策略师，精通邮件营销自动化、用户分群和转化率优化。',
  'sales-account-strategist.md': '客户策略经理，专注于客户关系管理、续约率提升和客户价值最大化。',
  'sales-proposal-strategist.md': '商务提案策略专家，擅长撰写高质量商业提案，提升项目成功率和客户转化率。',
  'sales-engineer.md': '销售工程师，结合技术专长和销售能力，为客户提供技术解决方案和售前支持。',
  'product-manager.md': '产品经理，负责产品规划、需求分析和跨团队协作，推动产品成功落地。',
  'product-feedback-synthesizer.md': '产品反馈分析师，专注于收集和分析用户反馈，将定性反馈转化为产品改进优先级。',
  'finance-financial-analyst.md': '财务分析师，擅长财务建模、预测分析和数据驱动的决策支持，助力战略规划和投资决策。',
  'finance-fpa-analyst.md': '财务规划与分析师（FP&A），精通预算编制、差异分析和滚动预测，连接财务数据与业务战略。',
};


interface AgentFrontmatter {
  name: string;
  description: string;
  color?: string;
  emoji?: string;
  vibe?: string;
}

interface ParsedAgent {
  frontmatter: AgentFrontmatter;
  content: string;
  filePath: string;
  nameCn: string;
  industryCn: string;
}

/**
 * 解析 agent markdown 文件
 */
function parseAgentFile(repoPath: string, agentConfig: typeof CURATED_AGENTS[0]): ParsedAgent | null {
  const filePath = path.join(repoPath, agentConfig.file);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  文件不存在: ${filePath}`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: body } = matter(content);

    if (!data.name || !data.description) {
      console.warn(`⚠️  跳过 ${filePath}：缺少 name 或 description`);
      return null;
    }

    return {
      frontmatter: data as AgentFrontmatter,
      content: body,
      filePath,
      nameCn: agentConfig.name_cn,
      industryCn: agentConfig.industry_cn,
    };
  } catch (error: any) {
    console.error(`❌ 解析失败 ${filePath}:`, error.message);
    return null;
  }
}

/**
 * 从 agent content 中提取技能
 * 策略：从不同的 markdown section 提取 3-5 个技能
 */
function extractCapabilities(agent: ParsedAgent): Array<{ name: string; description: string; template: string }> {
  const capabilities: Array<{ name: string; description: string; template: string }> = [];
  const lines = agent.content.split('\n');

  // 技能 1: 核心使命（Core Mission）
  const coreMissionMatch = agent.content.match(/## 🎯 Your Core Mission\n([\s\S]*?)(?=\n##|$)/);
  if (coreMissionMatch) {
    const coreMissionContent = coreMissionMatch[1].trim();
    const firstParagraph = coreMissionContent.split('\n\n')[0];

    capabilities.push({
      name: `${agent.nameCn}核心能力`,
      description: firstParagraph.substring(0, 200),
      template: agent.content, // 完整保留
    });
  }

  // 技能 2-4: 从 Core Capabilities 提取子能力
  const capabilitiesMatch = agent.content.match(/## 📋 Your Core Capabilities\n([\s\S]*?)(?=\n##|$)/);
  if (capabilitiesMatch) {
    const capabilitiesContent = capabilitiesMatch[1];
    const subsections = capabilitiesContent.split('###').slice(1); // 跳过第一个空元素

    for (let i = 0; i < Math.min(3, subsections.length); i++) {
      const subsection = subsections[i].trim();
      const titleMatch = subsection.match(/^(.+?)\n/);

      if (titleMatch) {
        const title = titleMatch[1].trim();
        const content = subsection.substring(titleMatch[0].length).trim();
        const description = content.split('\n')[0].substring(0, 200);

        capabilities.push({
          name: `${agent.nameCn} - ${title}`,
          description,
          template: agent.content,
        });
      }
    }
  }

  // 如果提取失败，至少创建一个默认技能
  if (capabilities.length === 0) {
    capabilities.push({
      name: `${agent.nameCn}专业技能`,
      description: agent.frontmatter.description,
      template: agent.content,
    });
  }

  return capabilities;
}

/**
 * 获取或创建技能（技能共享机制）
 */
async function getOrCreateCapability(
  name: string,
  description: string,
  template: string,
  contributorId: string,
  cache: Map<string, string>
): Promise<string> {
  // 检查缓存
  if (cache.has(name)) {
    return cache.get(name)!;
  }

  // 检查数据库
  const existing = await prisma.capability.findFirst({
    where: { name },
  });

  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }

  // 创建新技能
  const capability = await prisma.capability.create({
    data: {
      name,
      description,
      type: CapabilityType.SKILL,
      status: CapabilityStatus.ACTIVE,
      contributorId,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '任务描述' },
        },
        required: ['task'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          result: { type: 'string', description: '执行结果' },
        },
      },
      skillConfig: {
        create: {
          template,
          modelId: '', // 空字符串表示跟随会话默认模型
        },
      },
    },
  });

  cache.set(name, capability.id);
  console.log(`  ✅ 创建技能: ${name}`);
  return capability.id;
}

/**
 * 导入单个员工
 */
async function importAgent(
  agent: ParsedAgent,
  skillsCache: Map<string, string>,
  contributorId: string
) {
  const { frontmatter, content, nameCn, industryCn } = agent;

  // 提取 systemPrompt
  const identityMatch = content.match(/## 🧠 Your Identity & Memory\n([\s\S]*?)(?=\n##|$)/);
  const missionMatch = content.match(/## 🎯 Your Core Mission\n([\s\S]*?)(?=\n##|$)/);

  const systemPrompt = `${identityMatch?.[1] || ''}\n\n${missionMatch?.[1] || ''}`.trim() ||
    content.substring(0, 1000);

  // 使用预设的中文简介
  const fileName = path.basename(agent.filePath);
  const descriptionCn = DESCRIPTION_TRANSLATIONS[fileName] || frontmatter.description.substring(0, 200);


  // 创建数字员工
  const employee = await prisma.digitalEmployee.create({
    data: {
      name: nameCn,
      description: descriptionCn.substring(0, 500),
      position: nameCn,
      industry: industryCn,
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${Date.now()}-${Math.random()}`,
      modelId: '', // 空字符串表示跟随会话默认模型
      systemPrompt,
      annualPriceCNY: 30000,
      includedComputeCNY: 6000,
      status: EmployeeStatus.APPROVED,
    },
  });

  console.log(`✅ 创建员工: ${nameCn} (${employee.id})`);

  // 提取并绑定技能
  const capabilities = extractCapabilities(agent);

  for (let i = 0; i < capabilities.length; i++) {
    const cap = capabilities[i];
    const capabilityId = await getOrCreateCapability(
      cap.name,
      cap.description,
      cap.template,
      contributorId,
      skillsCache
    );

    await prisma.employeeCapabilityBinding.create({
      data: {
        employeeId: employee.id,
        capabilityId,
        priority: i + 1,
        enabled: true,
      },
    });

    console.log(`  🔗 绑定技能: ${cap.name}`);
  }

  return employee;
}

/**
 * 主函数
 */
async function main() {
  const repoPath = '/tmp/agency-agents';

  if (!fs.existsSync(repoPath)) {
    console.error(`❌ 仓库路径不存在: ${repoPath}`);
    console.error('请先运行: git clone https://github.com/yaoruiquan/agency-agents /tmp/agency-agents');
    process.exit(1);
  }

  // 查找或创建默认贡献者
  let contributor = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!contributor) {
    contributor = await prisma.user.create({
      data: {
        email: 'system@example.com',
        password: 'dummy-hash',
        role: 'ADMIN',
        nickname: '系统管理员',
      },
    });
  }

  console.log(`\n📦 开始导入 ${CURATED_AGENTS.length} 个精选员工...\n`);

  const skillsCache = new Map<string, string>();
  let successCount = 0;

  for (const agentConfig of CURATED_AGENTS) {
    const agent = parseAgentFile(repoPath, agentConfig);

    if (!agent) {
      console.warn(`⚠️  跳过: ${agentConfig.file}`);
      continue;
    }

    try {
      await importAgent(agent, skillsCache, contributor.id);
      successCount++;
      console.log('');
    } catch (error: any) {
      console.error(`❌ 导入失败 ${agentConfig.name_cn}:`, error.message);
    }
  }

  console.log(`\n✅ 导入完成！`);
  console.log(`   成功: ${successCount}/${CURATED_AGENTS.length} 个员工`);
  console.log(`   技能数: ${skillsCache.size} 个`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('❌ 导入失败:', error);
  prisma.$disconnect();
  process.exit(1);
});
