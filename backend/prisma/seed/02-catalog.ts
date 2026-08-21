/**
 * 技能优先的市场目录。能力先入库并绑定，再将员工发布为 APPROVED。
 * 同步为幂等增量，不会删除或重置既有业务数据。
 */
import { CapabilityType, EmployeeCategory, EmployeeStatus, Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

const AGENCY_AGENTS_ROOT = path.join(process.env.HOME || '', '.agency-agents');

type CuratedEmployee = {
  name: string;
  position: string;
  description: string;
  systemPrompt: string;
  monthlyPrice: number;
  category: EmployeeCategory;
  skills: string[];
};

const CURATED_ECOMMERCE_EMPLOYEES: CuratedEmployee[] = [
  { name: '国内电商运营专家', position: '电商运营专家', description: '负责淘宝、天猫、拼多多、京东及抖店的店铺经营、商品优化、大促规划与转化复盘。', systemPrompt: '你是国内电商运营专家，围绕商品、流量、转化和复购制定可执行的店铺经营方案，并明确数据口径和复盘动作。', monthlyPrice: 499, category: 'ECOMMERCE', skills: ['marketing/marketing-china-ecommerce-operator.md'] },
  { name: '直播电商增长教练', position: '直播电商增长教练', description: '为抖音、快手、淘宝直播和视频号设计直播脚本、货品节奏、主播训练及转化漏斗优化方案。', systemPrompt: '你是直播电商增长教练，基于流量、停留、转化和客单价数据优化直播间脚本、货品组合与主播训练计划。', monthlyPrice: 499, category: 'ECOMMERCE', skills: ['marketing/marketing-livestream-commerce-coach.md'] },
  { name: '私域复购运营师', position: '私域运营师', description: '搭建企业微信与 SCRM 私域体系，按用户分层规划社群运营、生命周期触达与复购增长。', systemPrompt: '你是私域复购运营师，以用户分层和长期信任为基础，输出企业微信、社群和复购运营的可执行方案。', monthlyPrice: 449, category: 'ECOMMERCE', skills: ['marketing/marketing-private-domain-operator.md'] },
  { name: '电商投放优化师', position: '电商投放优化师', description: '规划站内外投放结构、预算与归因体系，持续诊断并提升电商投放的增量转化效率。', systemPrompt: '你是电商投放优化师，先校验转化追踪和归因，再给出账户结构、预算分配、出价与实验方案。', monthlyPrice: 549, category: 'MARKETING_GROWTH', skills: ['paid-media/paid-media-ppc-strategist.md', 'paid-media/paid-media-tracking-specialist.md'] },
  { name: '商品内容与详情页策划', position: '商品内容策划', description: '提炼商品卖点，规划详情页信息架构、视觉叙事和短视频内容，使内容服务于理解与转化。', systemPrompt: '你是商品内容与详情页策划，围绕目标客群、购买顾虑和商品证据，产出可落地的详情页及内容方案。', monthlyPrice: 449, category: 'ECOMMERCE', skills: ['marketing/marketing-content-creator.md', 'design/design-visual-storyteller.md'] },
  { name: '电商售后与退货专员', position: '电商售后专员', description: '处理退换货、客诉与服务恢复，完善售后 SOP、风险识别和退货原因分析。', systemPrompt: '你是电商售后与退货专员，在兼顾平台规则、客户体验和风险控制的前提下，设计清晰的售后处理方案。', monthlyPrice: 399, category: 'ECOMMERCE', skills: ['specialized/retail-customer-returns.md', 'specialized/customer-service.md'] },
];

// 显式名称回填：禁止再按岗位或行业自由文本推测分类。
const HISTORICAL_CATEGORY_BY_NAME: Record<string, EmployeeCategory> = {
  '全栈架构师': 'TECH', '前端工程师': 'TECH', '后端工程师': 'TECH', '移动端开发': 'TECH', 'DevOps 工程师': 'TECH', '数据可视化工程师': 'TECH', 'Rust 重构专家': 'TECH', 'WebAssembly 工程师': 'TECH', '代码审查专家': 'TECH', '微调优化专家': 'TECH', 'API 设计师': 'TECH', '测试自动化工程师': 'TECH', '性能基准测试专家': 'TECH', '无障碍测试专家': 'TECH', '游戏开发工程师': 'TECH', '安全架构师': 'TECH', '密钥管理专家': 'TECH', '威胁情报分析师': 'TECH',
  'UX 架构师': 'PRODUCT_DESIGN', 'UI 设计师': 'PRODUCT_DESIGN', 'UX 研究员': 'PRODUCT_DESIGN', '品牌守护者': 'PRODUCT_DESIGN', 'AI 图片提示词工程师': 'PRODUCT_DESIGN', 'UI 完成度审查员': 'PRODUCT_DESIGN', '趣味注入专家': 'PRODUCT_DESIGN', '无障碍视觉专家': 'PRODUCT_DESIGN', '产品经理': 'PRODUCT_DESIGN', '用户反馈分析师': 'PRODUCT_DESIGN', '产品趋势研究员': 'PRODUCT_DESIGN',
  '抖音运营策略师': 'MARKETING_GROWTH', '知乎运营策略师': 'MARKETING_GROWTH', 'Reddit 社区运营': 'MARKETING_GROWTH', 'SEO 优化专家': 'MARKETING_GROWTH', '播客运营策略师': 'MARKETING_GROWTH', '多平台内容分发': 'MARKETING_GROWTH',
  '跨境电商运营': 'ECOMMERCE',
  '销售教练': 'SALES_CUSTOMER', '销售提案专家': 'SALES_CUSTOMER', '大客户销售': 'SALES_CUSTOMER', '外呼销售策略师': 'SALES_CUSTOMER', '销售工程师': 'SALES_CUSTOMER',
  '项目经理': 'OPERATIONS_ORG', '会议纪要专家': 'OPERATIONS_ORG', '招聘专家': 'OPERATIONS_ORG', '变革管理顾问': 'OPERATIONS_ORG', '文档生成专家': 'OPERATIONS_ORG',
  '财务分析师': 'FINANCE_LEGAL', '税务策略师': 'FINANCE_LEGAL', '法务客户接待': 'FINANCE_LEGAL', '应付账款专员': 'FINANCE_LEGAL',
};

type ParsedSkill = { sourcePath: string; name: string; description: string; template: string };

function parseSkill(sourcePath: string): ParsedSkill {
  const absolutePath = path.join(AGENCY_AGENTS_ROOT, sourcePath);
  if (!fs.existsSync(absolutePath)) throw new Error('技能文件不存在: ' + absolutePath);
  const parsed = matter(fs.readFileSync(absolutePath, 'utf8'));
  const name = typeof parsed.data.name === 'string' ? parsed.data.name : '';
  const description = typeof parsed.data.description === 'string' ? parsed.data.description : '';
  if (!name || !description) throw new Error('技能缺少 name 或 description: ' + sourcePath);
  return { sourcePath, name, description, template: parsed.content };
}

async function ensureSkillCapability(tx: Prisma.TransactionClient, skill: ParsedSkill, contributorId: string) {
  const metadata = { sourcePath: skill.sourcePath, catalog: 'curated-ecommerce' };
  const existing = await tx.capability.findFirst({ where: { metadata: { path: ['sourcePath'], equals: skill.sourcePath } }, select: { id: true } });
  const data = { name: skill.name, description: skill.description, status: 'APPROVED' as const, metadata, skillConfig: { upsert: { create: { template: skill.template }, update: { template: skill.template } } } };
  if (existing) return (await tx.capability.update({ where: { id: existing.id }, data })).id;
  return (await tx.capability.create({ data: { name: skill.name, description: skill.description, type: CapabilityType.SKILL, industry: ['电商'], position: [], inputSchema: {}, outputSchema: {}, contributor: { connect: { id: contributorId } }, status: 'APPROVED', approvedAt: new Date(), metadata, skillConfig: { create: { template: skill.template } } } })).id;
}

export interface SeededCatalog {
  employees: Array<{ id: string; name: string; status: EmployeeStatus }>;
  unmappedHistoricalEmployees: string[];
}

export async function backfillFunctionalCategories(prisma: PrismaClient) {
  const employees = await prisma.digitalEmployee.findMany({ select: { id: true, name: true } });
  await prisma.$transaction(employees.flatMap((employee) => {
    const functionalCategory = HISTORICAL_CATEGORY_BY_NAME[employee.name];
    return functionalCategory ? [prisma.digitalEmployee.update({ where: { id: employee.id }, data: { functionalCategory } })] : [];
  }));
  return employees.filter((employee) => !HISTORICAL_CATEGORY_BY_NAME[employee.name] && !CURATED_ECOMMERCE_EMPLOYEES.some((item) => item.name === employee.name)).map((employee) => employee.name);
}

export async function seedCatalog(prisma: PrismaClient, contributorId: string): Promise<SeededCatalog> {
  const parsedSkills = new Map<string, ParsedSkill>();
  for (const employee of CURATED_ECOMMERCE_EMPLOYEES) for (const sourcePath of employee.skills) if (!parsedSkills.has(sourcePath)) parsedSkills.set(sourcePath, parseSkill(sourcePath));
  const created: Array<{ id: string; name: string; status: EmployeeStatus }> = [];
  for (const employee of CURATED_ECOMMERCE_EMPLOYEES) {
    const result = await prisma.$transaction(async (tx) => {
      const skillIds = await Promise.all(employee.skills.map((sourcePath) => ensureSkillCapability(tx, parsedSkills.get(sourcePath)!, contributorId)));
      if (skillIds.length === 0) throw new Error('员工没有可绑定技能: ' + employee.name);
      const values = { description: employee.description, industry: '电商', position: employee.position, functionalCategory: employee.category, avatar: null, systemPrompt: employee.systemPrompt, modelId: 'gpt-4o', maxSteps: 10, version: '1.0.0', annualPriceCNY: employee.monthlyPrice * 12, includedComputeCNY: employee.monthlyPrice * 12 * 0.2 };
      const existing = await tx.digitalEmployee.findFirst({ where: { name: employee.name }, select: { id: true } });
      const bindings = skillIds.map((capabilityId, index) => ({ capabilityId, priority: 100 - index, enabled: true }));
      const draft = existing
        ? await tx.digitalEmployee.update({ where: { id: existing.id }, data: { ...values, status: 'DRAFT', publishedAt: null } })
        : await tx.digitalEmployee.create({ data: { name: employee.name, ...values, status: 'DRAFT' } });
      await tx.employeeCapabilityBinding.createMany({
        data: bindings.map((binding) => ({ ...binding, employeeId: draft.id })),
        skipDuplicates: true,
      });
      return tx.digitalEmployee.update({ where: { id: draft.id }, data: { status: 'APPROVED', publishedAt: new Date() } });
    });
    created.push({ id: result.id, name: result.name, status: result.status });
  }
  return { employees: created, unmappedHistoricalEmployees: await backfillFunctionalCategories(prisma) };
}
