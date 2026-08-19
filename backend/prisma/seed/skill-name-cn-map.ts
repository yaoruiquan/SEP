/**
 * skill-name-cn-map.ts - 技能英文名到中文名的映射
 *
 * 从 agency-agents 读取的技能 name 是英文，前端显示需要中文。
 * 这里提供映射函数，用于种子数据和运行时显示。
 */

export const SKILL_NAME_CN: Record<string, string> = {
  // Engineering
  'Backend Architect': '后端架构师',
  'Frontend Architect': '前端架构师',
  'Software Architect': '软件架构师',
  'Mobile App Builder': '移动应用开发',
  'DevOps Engineer': 'DevOps 工程师',
  'Data Visualization Engineer': '数据可视化工程师',
  'Rust Refactoring Specialist': 'Rust 重构专家',
  'WebAssembly Engineer': 'WebAssembly 工程师',
  'Code Reviewer': '代码审查专家',
  'Minimal Change Engineer': '微调优化专家',
  'API Designer': 'API 设计师',

  // Testing
  'Test Automation Engineer': '测试自动化工程师',
  'API Tester': 'API 测试工程师',
  'Performance Benchmarker': '性能基准测试专家',
  'Accessibility Auditor': '无障碍测试专家',

  // Design
  'UX Architect': 'UX 架构师',
  'UI Designer': 'UI 设计师',
  'UX Researcher': 'UX 研究员',
  'Brand Guardian': '品牌守护者',
  'Visual Storyteller': '视觉叙事专家',
  'Image Prompt Engineer': 'AI 图片提示词工程师',
  'UI Finish Gate Reviewer': 'UI 完成度审查员',
  'Whimsy Injector': '趣味注入专家',
  'Inclusive Visuals Specialist': '无障碍视觉专家',
  'Persona Walkthrough': '用户画像演练',

  // Product
  'Product Manager': '产品经理',
  'Sprint Prioritizer': '迭代优先级规划',
  'Feedback Synthesizer': '用户反馈分析师',
  'Trend Researcher': '产品趋势研究员',

  // Project Management
  'Senior Project Manager': '高级项目经理',
  'Scrum Master': 'Scrum 大师',

  // Game Development
  'Game Designer': '游戏设计师',
  'Technical Artist': '技术美术',

  // Content & Marketing
  'Content Strategist': '内容策略师',
  'SEO Specialist': 'SEO 专家',
  'Social Media Manager': '社交媒体运营',
  'Email Marketing Specialist': '邮件营销专家',
  'Copywriter': '文案撰稿人',
  'Video Script Writer': '视频脚本作者',

  // Data & Analytics
  'Data Analyst': '数据分析师',
  'Business Intelligence Engineer': '商业智能工程师',
  'Machine Learning Engineer': '机器学习工程师',

  // Customer Service
  'Customer Support Agent': '客服专员',
  'Technical Support Engineer': '技术支持工程师',

  // Finance & Legal
  'Financial Analyst': '财务分析师',
  'Legal Consultant': '法律顾问',
  'Compliance Officer': '合规官',

  // HR & Admin
  'HR Specialist': '人力资源专员',
  'Recruiter': '招聘专员',
  'Office Manager': '行政经理',
};

/**
 * 获取技能的中文名称，如果没有映射则返回原英文名
 */
export function getSkillNameCN(englishName: string): string {
  return SKILL_NAME_CN[englishName] || englishName;
}
