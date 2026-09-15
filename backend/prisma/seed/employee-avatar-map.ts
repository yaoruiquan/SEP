/**
 * 硅基员工 -> 本地头像素材的稳定映射。
 *
 * 由 tmp/imagegen/build-silicon-personas.py 生成，勿手工改动单条映射；
 * 新增员工请在生成脚本里补一行，再重新导出本文件。
 *
 * 素材路径：web/public/assets/employees/silicon/<slug>.webp（512/256 两档）
 */

export const SILICON_AVATAR_DIR = '/assets/employees/silicon';

/** 员工姓名 -> 素材 slug */
export const SILICON_AVATAR_SLUG_BY_NAME: Record<string, string> = {
  '全栈架构师': 'fullstack-architect',
  '前端工程师': 'frontend-engineer',
  '后端工程师': 'backend-engineer',
  '移动端开发': 'mobile-engineer',
  'DevOps 工程师': 'devops-engineer',
  '数据可视化工程师': 'dataviz-engineer',
  'Rust 重构专家': 'rust-refactor',
  'WebAssembly 工程师': 'wasm-engineer',
  '代码审查专家': 'code-reviewer',
  '微调优化专家': 'micro-optimizer',
  'API 设计师': 'api-designer',
  '测试自动化工程师': 'qa-automation',
  '性能基准测试专家': 'perf-benchmark',
  '无障碍测试专家': 'a11y-tester',
  '游戏开发工程师': 'game-engineer',
  'UX 架构师': 'ux-architect',
  'UI 设计师': 'ui-designer',
  'UX 研究员': 'ux-researcher',
  '品牌守护者': 'brand-guardian',
  'AI 图片提示词工程师': 'ai-prompt-engineer',
  'UI 完成度审查员': 'ui-polish-reviewer',
  '趣味注入专家': 'delight-injector',
  '无障碍视觉专家': 'a11y-visual',
  '产品经理': 'product-manager',
  '用户反馈分析师': 'user-feedback-analyst',
  '产品趋势研究员': 'product-trend-researcher',
  '项目经理': 'project-manager',
  '会议纪要专家': 'meeting-notes',
  '抖音运营策略师': 'douyin-strategist',
  '知乎运营策略师': 'zhihu-strategist',
  '跨境电商运营': 'cross-border-ecom',
  'Reddit 社区运营': 'reddit-community',
  'SEO 优化专家': 'seo-expert',
  '播客运营策略师': 'podcast-strategist',
  '多平台内容分发': 'multichannel-content',
  '销售教练': 'sales-coach',
  '销售提案专家': 'sales-proposal',
  '大客户销售': 'enterprise-account',
  '外呼销售策略师': 'outbound-sales',
  '销售工程师': 'sales-engineer',
  '安全架构师': 'security-architect',
  '密钥管理专家': 'key-management',
  '威胁情报分析师': 'threat-intel-analyst',
  '财务分析师': 'financial-analyst',
  '税务策略师': 'tax-strategist',
  '招聘专家': 'recruiter',
  '法务客户接待': 'legal-reception',
  '变革管理顾问': 'change-consultant',
  '文档生成专家': 'doc-generator',
  '应付账款专员': 'ap-specialist',
  '供应链分析师': 'spare-supply-chain',
  '国内电商运营专家': 'cn-ecom-operator',
  '直播电商增长教练': 'livestream-coach',
  '私域复购运营师': 'private-domain-operator',
  '电商投放优化师': 'ecom-media-buyer',
  '商品内容与详情页策划': 'product-content-planner',
  '电商售后与退货专员': 'after-sales-specialist',
  '数据科学家': 'spare-data-scientist',
  '法务顾问': 'spare-legal-counsel',
  '人力资源经理': 'spare-hr-manager',
  '运营经理': 'spare-ops-manager',
  '人事专员': 'spare-hr-specialist',
  '培训发展负责人': 'spare-training-lead',
  '商业分析师': 'spare-biz-analyst',
};

/** 备用素材（新增岗位/演示账号），按顺序取用 */
export const SILICON_SPARE_SLUGS: string[] = [
  'spare-supply-chain',
  'spare-data-scientist',
  'spare-legal-counsel',
  'spare-hr-manager',
  'spare-ops-manager',
  'spare-hr-specialist',
  'spare-training-lead',
  'spare-biz-analyst',
];

/** 返回员工的本地头像 URL；没有映射时返回 null，由调用方回落到原 avatar 字段。 */
export function siliconAvatarUrl(name?: string | null): string | null {
  if (!name) return null;
  const slug = SILICON_AVATAR_SLUG_BY_NAME[name.trim()];
  return slug ? `${SILICON_AVATAR_DIR}/${slug}.webp` : null;
}
