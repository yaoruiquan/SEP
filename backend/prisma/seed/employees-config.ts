/**
 * employees-config.ts - 50 个数字员工定义
 *
 * 每个员工包含：
 * - 基本信息（name, title, bio）
 * - 绑定的技能列表（1-3 个相关技能）
 */

export interface EmployeeConfig {
  name: string;
  title: string;
  bio: string;
  monthlyPrice: number;
  tags: string[];
  skills: string[]; // agency-agents 技能文件路径（相对于 ~/.agency-agents/）
}

export const EMPLOYEES: EmployeeConfig[] = [
  // ==================== 工程开发类 (15 人) ====================
  {
    name: '全栈架构师',
    title: '全栈架构师',
    bio: '精通前后端架构设计，擅长系统重构和技术选型。10年+ 大型项目经验，帮你打造可扩展的技术架构。',
    monthlyPrice: 499,
    tags: ['工程', '架构', '全栈'],
    skills: [
      'engineering/engineering-software-architect.md',
      'engineering/engineering-backend-architect.md',
      'engineering/engineering-frontend-architect.md',
    ],
  },
  {
    name: '前端工程师',
    title: '前端工程师',
    bio: 'React/Vue 专家，注重用户体验和性能优化。会写优雅的组件，也懂设计系统。',
    monthlyPrice: 399,
    tags: ['工程', '前端', 'UI'],
    skills: [
      'engineering/engineering-frontend-architect.md',
      'design/design-ui-designer.md',
    ],
  },
  {
    name: '后端工程师',
    title: '后端工程师',
    bio: 'Node.js/Python 高手，擅长 API 设计和数据库优化。写过百万级并发系统。',
    monthlyPrice: 399,
    tags: ['工程', '后端', 'API'],
    skills: [
      'engineering/engineering-backend-architect.md',
      'engineering/engineering-api-designer.md',
    ],
  },
  {
    name: '移动端开发',
    title: '移动端开发',
    bio: 'iOS/Android 双平台开发经验，熟悉 React Native 和 Flutter。让你的 App 流畅丝滑。',
    monthlyPrice: 399,
    tags: ['工程', '移动端', 'App'],
    skills: [
      'engineering/engineering-mobile-app-builder.md',
    ],
  },
  {
    name: 'DevOps 工程师',
    title: 'DevOps 工程师',
    bio: 'CI/CD、Docker、K8s 全栈运维，让部署像呼吸一样自然。',
    monthlyPrice: 399,
    tags: ['工程', 'DevOps', '运维'],
    skills: [
      'engineering/engineering-devops-engineer.md',
    ],
  },
  {
    name: '数据可视化工程师',
    title: '数据可视化工程师',
    bio: '把数据变成故事，用图表说话。精通 D3.js、ECharts，让枯燥的数据活起来。',
    monthlyPrice: 349,
    tags: ['工程', '数据', '可视化'],
    skills: [
      'engineering/engineering-data-visualization-engineer.md',
    ],
  },
  {
    name: 'Rust 重构专家',
    title: 'Rust 重构专家',
    bio: '帮你把 C++/Go 代码用 Rust 重写，性能翻倍，内存安全拉满。',
    monthlyPrice: 449,
    tags: ['工程', 'Rust', '重构'],
    skills: [
      'engineering/engineering-rust-refactoring-specialist.md',
    ],
  },
  {
    name: 'WebAssembly 工程师',
    title: 'WebAssembly 工程师',
    bio: '让 Web 应用跑出原生速度，Wasm + Rust 是我的杀手锏。',
    monthlyPrice: 449,
    tags: ['工程', 'WebAssembly', '性能'],
    skills: [
      'engineering/engineering-webassembly-engineer.md',
    ],
  },
  {
    name: '代码审查专家',
    title: '代码审查专家',
    bio: '帮你 Code Review，发现潜在 Bug，提升代码质量。严格但友好。',
    monthlyPrice: 299,
    tags: ['工程', '代码审查', '质量'],
    skills: [
      'engineering/engineering-code-reviewer.md',
    ],
  },
  {
    name: '微调优化专家',
    title: '微调优化专家',
    bio: '专注小改动大收益，不重构也能让系统更快更稳。',
    monthlyPrice: 299,
    tags: ['工程', '优化', '重构'],
    skills: [
      'engineering/engineering-minimal-change-engineer.md',
    ],
  },
  {
    name: 'API 设计师',
    title: 'API 设计师',
    bio: 'RESTful、GraphQL、gRPC 都玩得转，设计的 API 开发者都说好用。',
    monthlyPrice: 349,
    tags: ['工程', 'API', '接口设计'],
    skills: [
      'engineering/engineering-api-designer.md',
    ],
  },
  {
    name: '测试自动化工程师',
    title: '测试自动化工程师',
    bio: '写测试比写代码还快，让你的 CI 绿得发光。',
    monthlyPrice: 299,
    tags: ['工程', '测试', '自动化'],
    skills: [
      'testing/testing-test-automation-engineer.md',
      'testing/testing-api-tester.md',
    ],
  },
  {
    name: '性能基准测试专家',
    title: '性能基准测试专家',
    bio: '找出性能瓶颈，给出优化方案，让系统快到飞起。',
    monthlyPrice: 349,
    tags: ['工程', '性能', '测试'],
    skills: [
      'testing/testing-performance-benchmarker.md',
    ],
  },
  {
    name: '无障碍测试专家',
    title: '无障碍测试专家',
    bio: '让你的产品对所有人友好，WCAG 合规性检查和优化建议。',
    monthlyPrice: 299,
    tags: ['工程', '无障碍', '测试'],
    skills: [
      'testing/testing-accessibility-auditor.md',
    ],
  },
  {
    name: '游戏开发工程师',
    title: '游戏开发工程师',
    bio: 'Unity/Unreal 双修，做过 3A 大作也做过独立游戏。',
    monthlyPrice: 449,
    tags: ['游戏', '开发', 'Unity'],
    skills: [
      'game-development/game-designer.md',
      'game-development/technical-artist.md',
    ],
  },

  // ==================== 设计类 (8 人) ====================
  {
    name: 'UX 架构师',
    title: 'UX 架构师',
    bio: '设计信息架构和用户流程，让复杂产品变简单。',
    monthlyPrice: 449,
    tags: ['设计', 'UX', '架构'],
    skills: [
      'design/design-ux-architect.md',
      'design/design-ux-researcher.md',
    ],
  },
  {
    name: 'UI 设计师',
    title: 'UI 设计师',
    bio: 'Figma 高手，设计系统建设者，让界面既美观又好用。',
    monthlyPrice: 399,
    tags: ['设计', 'UI', 'Figma'],
    skills: [
      'design/design-ui-designer.md',
      'design/design-brand-guardian.md',
    ],
  },
  {
    name: 'UX 研究员',
    title: 'UX 研究员',
    bio: '用户访谈、可用性测试、A/B 测试，用数据驱动设计决策。',
    monthlyPrice: 349,
    tags: ['设计', 'UX', '研究'],
    skills: [
      'design/design-ux-researcher.md',
      'design/design-persona-walkthrough.md',
    ],
  },
  {
    name: '品牌守护者',
    title: '品牌守护者',
    bio: '确保品牌视觉一致性，输出品牌设计规范和资产管理。',
    monthlyPrice: 349,
    tags: ['设计', '品牌', '视觉'],
    skills: [
      'design/design-brand-guardian.md',
      'design/design-visual-storyteller.md',
    ],
  },
  {
    name: 'AI 图片提示词工程师',
    title: 'AI 图片提示词工程师',
    bio: 'MidJourney/DALL-E 专家，帮你生成完美的 AI 图片提示词。',
    monthlyPrice: 299,
    tags: ['设计', 'AI', '提示词'],
    skills: [
      'design/design-image-prompt-engineer.md',
    ],
  },
  {
    name: 'UI 完成度审查员',
    title: 'UI 完成度审查员',
    bio: '像素级检查 UI 实现，确保设计稿 100% 还原。',
    monthlyPrice: 249,
    tags: ['设计', 'UI', '审查'],
    skills: [
      'design/design-ui-finish-gate-reviewer.md',
    ],
  },
  {
    name: '趣味注入专家',
    title: '趣味注入专家',
    bio: '给产品加点 "灵魂"，微交互、彩蛋、小惊喜，让用户会心一笑。',
    monthlyPrice: 299,
    tags: ['设计', '交互', '趣味'],
    skills: [
      'design/design-whimsy-injector.md',
    ],
  },
  {
    name: '无障碍视觉专家',
    title: '无障碍视觉专家',
    bio: '确保设计对视觉障碍用户友好，色彩对比度、可读性优化。',
    monthlyPrice: 299,
    tags: ['设计', '无障碍', '包容性'],
    skills: [
      'design/design-inclusive-visuals-specialist.md',
    ],
  },

  // ==================== 产品类 (5 人) ====================
  {
    name: '产品经理',
    title: '产品经理',
    bio: '从 0 到 1 做产品，需求分析、原型设计、敏捷迭代全搞定。',
    monthlyPrice: 449,
    tags: ['产品', '需求', '敏捷'],
    skills: [
      'product/product-manager.md',
      'product/product-sprint-prioritizer.md',
    ],
  },
  {
    name: '用户反馈分析师',
    title: '用户反馈分析师',
    bio: '收集用户反馈，提炼核心需求，输出可执行的产品迭代方案。',
    monthlyPrice: 349,
    tags: ['产品', '反馈', '分析'],
    skills: [
      'product/product-feedback-synthesizer.md',
    ],
  },
  {
    name: '产品趋势研究员',
    title: '产品趋势研究员',
    bio: '追踪行业动态，竞品分析，帮你抓住下一个风口。',
    monthlyPrice: 349,
    tags: ['产品', '趋势', '研究'],
    skills: [
      'product/product-trend-researcher.md',
    ],
  },
  {
    name: '项目经理',
    title: '项目经理',
    bio: 'Scrum Master 认证，带团队做过百人项目，让交付准时又靠谱。',
    monthlyPrice: 399,
    tags: ['项目', '管理', 'Scrum'],
    skills: [
      'project-management/project-manager-senior.md',
      'project-management/project-management-jira-workflow-steward.md',
    ],
  },
  {
    name: '会议纪要专家',
    title: '会议纪要专家',
    bio: '自动提取会议要点、待办事项、决策记录，解放你的笔记本。',
    monthlyPrice: 199,
    tags: ['项目', '会议', '纪要'],
    skills: [
      'project-management/project-management-meeting-notes-specialist.md',
    ],
  },

  // ==================== 营销类 (7 人) ====================
  {
    name: '抖音运营策略师',
    title: '抖音运营策略师',
    bio: '抖音算法专家，帮你打造爆款短视频，涨粉变现一条龙。',
    monthlyPrice: 399,
    tags: ['营销', '抖音', '短视频'],
    skills: [
      'marketing/marketing-douyin-strategist.md',
    ],
  },
  {
    name: '知乎运营策略师',
    title: '知乎运营策略师',
    bio: '知乎盐值 800+，写过 100+ 万赞回答，帮你在知乎建立影响力。',
    monthlyPrice: 349,
    tags: ['营销', '知乎', '内容'],
    skills: [
      'marketing/marketing-zhihu-strategist.md',
    ],
  },
  {
    name: '跨境电商运营',
    title: '跨境电商运营',
    bio: 'Amazon/Shopify 全球开店经验，帮你把货卖到全世界。',
    monthlyPrice: 449,
    tags: ['营销', '跨境', '电商'],
    skills: [
      'marketing/marketing-cross-border-ecommerce.md',
    ],
  },
  {
    name: 'Reddit 社区运营',
    title: 'Reddit 社区运营',
    bio: '懂 Reddit 文化，帮你在各个 subreddit 建立存在感，不被 downvote。',
    monthlyPrice: 299,
    tags: ['营销', 'Reddit', '社区'],
    skills: [
      'marketing/marketing-reddit-community-builder.md',
    ],
  },
  {
    name: 'SEO 优化专家',
    title: 'SEO 优化专家',
    bio: '让你的网站在 Google 首页，懂 AI 搜索时代的 SEO 新玩法。',
    monthlyPrice: 399,
    tags: ['营销', 'SEO', '搜索优化'],
    skills: [
      'marketing/marketing-agentic-search-optimizer.md',
    ],
  },
  {
    name: '播客运营策略师',
    title: '播客运营策略师',
    bio: '从策划到推广，帮你打造有影响力的播客节目。',
    monthlyPrice: 349,
    tags: ['营销', '播客', '内容'],
    skills: [
      'marketing/marketing-global-podcast-strategist.md',
    ],
  },
  {
    name: '多平台内容分发',
    title: '多平台内容分发',
    bio: '一键分发内容到微信、抖音、小红书、B站，统一管理所有平台。',
    monthlyPrice: 299,
    tags: ['营销', '多平台', '内容'],
    skills: [
      'marketing/marketing-multi-platform-publisher.md',
    ],
  },

  // ==================== 销售类 (5 人) ====================
  {
    name: '销售教练',
    title: '销售教练',
    bio: '帮销售团队提升成交率，话术培训、异议处理、谈判技巧全覆盖。',
    monthlyPrice: 399,
    tags: ['销售', '培训', '教练'],
    skills: [
      'sales/sales-coach.md',
      'sales/sales-discovery-coach.md',
    ],
  },
  {
    name: '销售提案专家',
    title: '销售提案专家',
    bio: '写出让客户无法拒绝的提案，ROI 分析、案例包装一个不落。',
    monthlyPrice: 349,
    tags: ['销售', '提案', '方案'],
    skills: [
      'sales/sales-proposal-strategist.md',
    ],
  },
  {
    name: '大客户销售',
    title: '大客户销售',
    bio: 'Enterprise Sales 经验，擅长复杂决策链和长周期项目。',
    monthlyPrice: 449,
    tags: ['销售', '大客户', '企业'],
    skills: [
      'sales/sales-account-strategist.md',
      'sales/sales-deal-strategist.md',
    ],
  },
  {
    name: '外呼销售策略师',
    title: '外呼销售策略师',
    bio: '帮你设计高转化的外呼流程，Cold Call 也能暖起来。',
    monthlyPrice: 299,
    tags: ['销售', '外呼', '策略'],
    skills: [
      'sales/sales-outbound-strategist.md',
    ],
  },
  {
    name: '销售工程师',
    title: '销售工程师',
    bio: '既懂技术又懂销售，POC、技术方案演示、售前支持全搞定。',
    monthlyPrice: 399,
    tags: ['销售', '技术', '售前'],
    skills: [
      'sales/sales-engineer.md',
    ],
  },

  // ==================== 安全类 (3 人) ====================
  {
    name: '安全架构师',
    title: '安全架构师',
    bio: '从架构层面保障系统安全，渗透测试、威胁建模、安全审计样样精通。',
    monthlyPrice: 499,
    tags: ['安全', '架构', '渗透测试'],
    skills: [
      'security/security-architect.md',
      'security/security-appsec-engineer.md',
    ],
  },
  {
    name: '密钥管理专家',
    title: '密钥管理专家',
    bio: '帮你管理好所有 API Key、密码、证书，再也不用担心泄露。',
    monthlyPrice: 349,
    tags: ['安全', '密钥', '合规'],
    skills: [
      'security/security-secrets-credential-engineer.md',
    ],
  },
  {
    name: '威胁情报分析师',
    title: '威胁情报分析师',
    bio: '追踪最新漏洞和攻击手法，提前预警潜在风险。',
    monthlyPrice: 399,
    tags: ['安全', '威胁情报', '分析'],
    skills: [
      'security/security-threat-intelligence-analyst.md',
      'security/security-threat-detection-engineer.md',
    ],
  },

  // ==================== 财务类 (2 人) ====================
  {
    name: '财务分析师',
    title: '财务分析师',
    bio: '帮你看懂财务报表，做好预算规划，找到省钱的地方。',
    monthlyPrice: 399,
    tags: ['财务', '分析', '预算'],
    skills: [
      'finance/finance-financial-analyst.md',
      'finance/finance-fpa-analyst.md',
    ],
  },
  {
    name: '税务策略师',
    title: '税务策略师',
    bio: '合法节税，税务筹划，让你少交冤枉钱。',
    monthlyPrice: 449,
    tags: ['财务', '税务', '筹划'],
    skills: [
      'finance/finance-tax-strategist.md',
    ],
  },

  // ==================== 专业服务类 (5 人) ====================
  {
    name: '招聘专家',
    title: '招聘专家',
    bio: '帮你筛选简历、面试候选人、设计招聘流程，找到最合适的人才。',
    monthlyPrice: 349,
    tags: ['HR', '招聘', '人才'],
    skills: [
      'specialized/recruitment-specialist.md',
    ],
  },
  {
    name: '法务客户接待',
    title: '法务客户接待',
    bio: '律所前台必备，自动化客户信息收集和初步咨询。',
    monthlyPrice: 249,
    tags: ['法务', '客服', '接待'],
    skills: [
      'specialized/legal-client-intake.md',
      'specialized/legal-billing-time-tracking.md',
    ],
  },
  {
    name: '变革管理顾问',
    title: '变革管理顾问',
    bio: '帮企业平稳度过组织变革期，减少阻力，提升接受度。',
    monthlyPrice: 449,
    tags: ['咨询', '变革', '管理'],
    skills: [
      'specialized/change-management-consultant.md',
    ],
  },
  {
    name: '文档生成专家',
    title: '文档生成专家',
    bio: '自动生成合同、报告、提案等各类商务文档，格式规范内容准确。',
    monthlyPrice: 249,
    tags: ['文档', '自动化', '生成'],
    skills: [
      'specialized/specialized-document-generator.md',
    ],
  },
  {
    name: '应付账款专员',
    title: '应付账款专员',
    bio: '自动化处理账单、对账、付款流程，让财务工作更高效。',
    monthlyPrice: 299,
    tags: ['财务', '应付', '自动化'],
    skills: [
      'specialized/accounts-payable-agent.md',
    ],
  },
];
