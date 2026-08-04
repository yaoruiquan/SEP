/**
 * Recharts 玻璃主题常量（PRD Phase 4）
 *
 * recharts 把颜色画成 SVG 的 stroke / fill **属性**，不是 CSS class —— globals.css
 * 里的 `.theme-glass` 兜底层管不到它们。浅色主题下的 #e5e7eb 网格线、白色 Tooltip
 * 底在深蓝画布上分别是「看不见」和「白块糊脸」，所以这些值必须在 JS 侧换掉。
 *
 * 三个用到图表的页面（企业端 dashboard / usage、运营端 admin）共用这一份，
 * 避免同样的 hex 在三处漂移。
 */

/** 网格线：白 6% —— 深底上刚好能看出栅格，又不抢数据线 */
export const CHART_GRID = 'rgba(255, 255, 255, 0.08)';

/** 坐标轴文字：对应 --gtext-muted，压在画布上 4.6:1 */
export const CHART_AXIS_TICK = { fill: 'rgba(255, 255, 255, 0.48)', fontSize: 12 };

/** 坐标轴线本身 */
export const CHART_AXIS_LINE = 'rgba(255, 255, 255, 0.12)';

/**
 * Tooltip 浮层。
 * 走**实心** --surface-solid-raised 而非玻璃：Tooltip 跟着鼠标每帧移动，
 * backdrop-filter 会在移动中反复重算整块背景，实测掉帧（PRD §11 性能预算）。
 */
export const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: '#1a2137',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 12,
  boxShadow: '0 8px 32px rgba(31, 38, 135, 0.44)',
  fontSize: 12,
  color: 'rgba(255, 255, 255, 0.95)',
};

/** Tooltip 里的 label（日期那行）比数值弱一档 */
export const CHART_TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: 'rgba(255, 255, 255, 0.72)',
};

/** hover 时的高亮竖条 / 柱底色 */
export const CHART_CURSOR_FILL = 'rgba(255, 255, 255, 0.06)';

/**
 * 数据系列色 —— 取 --gneon-* 亮阶而非浅色主题的 500 阶。
 * #3b82f6（blue-500）压在 #0f0f2d 上只有 2.9:1，深底必须往亮的走。
 */
export const CHART_SERIES = {
  /** 主系列：Indigo 400，on canvas 6.25:1 */
  primary: '#818cf8',
  /** 次系列：Blue 400 */
  blue: '#60a5fa',
  /** 强调：Purple 400 */
  purple: '#c084fc',
  /** 正向指标：Green 400 */
  green: '#4ade80',
  /** 点缀：Cyan 400 */
  cyan: '#22d3ee',
} as const;
