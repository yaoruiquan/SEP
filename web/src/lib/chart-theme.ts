'use client';

/**
 * Recharts 主题常量（PRD Phase 4 / P1-8）
 *
 * recharts 把颜色画成 SVG 的 stroke / fill **属性**，不是 CSS class —— globals.css
 * 里的 `.theme-glass` 兜底层（SCOPED OVERRIDES）管不到它们。所以图表颜色必须在这里
 * 用 `var(--token)` 显式给：SVG 属性里的 var() 会按当前作用域解析，浅色 `:root` /
 * 暗色 `.theme-glass` / 浅玻璃 `.theme-glass-light` 三套都自动桥接。
 *
 * 历史教训：本文件曾把网格线、tooltip 底**写死成暗色值**（rgba(255,255,255,…) /
 * #1a2137），于是浅色主题下网格线和坐标轴文字**全看不见**；而 usage / analytics 两页
 * 反过来写死浅色值或用了**根本不存在**的 `var(--color-*)`（Tailwind v3 不生成该命名空间），
 * 暗色下瞎、柱状图两个主题都瞎。结论：chrome 一律走 var()，不要写死单主题 hex。
 *
 * 唯一的例外是**数据系列色**：一个色相没法靠 var() 在深底上自动「提亮」——浅色用的
 * Terracotta-700 压在 #0f0f2d 上对比度不足，深底必须换成更亮的 Terracotta-400 阶。
 * 这是分类色，故用 useChartSeries() 按主题返回两套色板，而不是 var()。
 */

import { useTheme } from '@/lib/theme-provider';

// ─── Chrome：网格 / 坐标轴 / Tooltip / 图例 ──────────────────────────────
// 全部 var() 形式，三套作用域自动桥接，无需按主题分支。

/** 网格线：--border 在浅色是 slate-200、暗色是玻璃亮边，两主题都「看得见但不抢数据线」 */
export const CHART_GRID = 'var(--border)';

/** 坐标轴文字：--fg-muted 浅色 slate-500、暗色桥到 --gtext-secondary，均 ≥4.5:1 */
export const CHART_AXIS_TICK = { fill: 'var(--fg-muted)', fontSize: 12 };

/** 坐标轴线本身 */
export const CHART_AXIS_LINE = 'var(--border)';

/**
 * Tooltip 浮层。
 * 走**实心** --surface-solid-raised（两玻璃作用域都定义了它：暗 #1a2137 / 浅 #fafbfc），
 * 而非半透明玻璃：Tooltip 跟着鼠标每帧移动，backdrop-filter 会在移动中反复重算整块
 * 背景，实测掉帧（PRD §11 性能预算）。兜底 var(--card) 防止哪天图表跑出了玻璃作用域。
 * 注意文字用 --fg（不是 --foreground —— 后者只是 Tailwind 键，CSS 变量里并不存在）。
 */
export const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--surface-solid-raised, var(--card))',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: 'var(--shadow-md)',
  fontSize: 12,
  color: 'var(--fg)',
};

/** Tooltip 里的 label（日期那行）比数值弱一档 */
export const CHART_TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: 'var(--fg-muted)',
};

/** hover 时的高亮竖条 / 柱底色 */
export const CHART_CURSOR_FILL = 'var(--muted)';

/** 图例文字 */
export const CHART_LEGEND_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
};

// ─── 数据系列色（分类色，按主题两套）──────────────────────────────────
// 浅色用饱和的 600 阶（白底够对比），暗色用提亮的 400 阶（深底够对比）。
// 每个值都已在对应画布上验过 ≥3:1（图形元素 WCAG 1.4.11 阈值），文字级用途另取更深的。

const LIGHT_SERIES = {
  primary: '#C4612F', // Terracotta-600
  blue: '#2563eb', //   blue-600
  teal: '#0d9488', //   teal-600
  purple: '#9333ea', // purple-600
  green: '#16a34a', //  green-600
  cyan: '#0891b2', //   cyan-600
  amber: '#d97706', //  amber-600
  slate: '#64748b', //  slate-500
} as const;

const DARK_SERIES = {
  primary: '#E07B47', // Terracotta-400
  blue: '#60a5fa', //   blue-400
  teal: '#2dd4bf', //   teal-400
  purple: '#c084fc', // purple-400
  green: '#4ade80', //  green-400
  cyan: '#22d3ee', //   cyan-400
  amber: '#fbbf24', //  amber-400
  slate: '#94a3b8', //  slate-400
} as const;

/** 色板形状：键固定，值放宽成 string（两套 hex 字面量不同，不能各自锁死）。 */
export type ChartSeries = Record<keyof typeof DARK_SERIES, string>;

/** 多系列 / 饼图的分类色板（6 色，按主题）。顺序：主色优先，冷暖交替便于区分相邻扇区。 */
export function useChartPalette(): string[] {
  const series = useChartSeries();
  return [series.primary, series.blue, series.teal, series.amber, series.purple, series.slate];
}

/**
 * 按当前主题返回数据系列色。SSR / Provider 外安全降级为浅色（与 aurora-background 同策略）。
 * 用法：`const S = useChartSeries(); <Area stroke={S.primary} …/>`
 */
export function useChartSeries(): ChartSeries {
  const { theme } = useTheme();
  return theme === 'dark' ? DARK_SERIES : LIGHT_SERIES;
}
