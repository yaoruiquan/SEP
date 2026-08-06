'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme-provider';

/**
 * 极光背景 —— Glassmorphism 的地基。
 *
 * 玻璃材质只有叠在彩色背景上才成立：`backdrop-filter` 模糊的是它「背后」的像素，
 * 纯白或纯黑底下它会退化成一个灰方块。所有用到 `.glass-*` 的页面都必须包在这个
 * 组件里（或至少包在带 `.theme-glass` 的容器里）。
 *
 * 结构分四层，靠 z-index 与 isolation 隔离：
 *   1. 画布底色（.theme-glass 或 .aurora-root-light，径向暖光 + 冷中性深色）
 *   2. 暖色/冷色 blob 层（.aurora-layer > .aurora-blob-*，z-index: -1）
 *   3. grain 纹理 / 网格叠加（伪元素，z-index: -1）
 *   4. children（默认层叠上下文，压在最上面）
 *
 * 性能：每个 blob 是一层 80px blur，3 个是硬上限，不要加第 4 个。
 * 动效由 globals.css 的 `prefers-reduced-motion` 统一关掉，这里不做 JS 判断。
 */
interface AuroraBackgroundProps {
  children: React.ReactNode;
  /** 作用在最外层容器上 */
  className?: string;
  /** 颗粒纹理，防止大面积渐变出现色带（banding）。默认开。 */
  grain?: boolean;
  /** 网格叠加，Hero 区用来增加科技感。默认关。 */
  grid?: boolean;
  /**
   * 是否注入 `.theme-glass` / `.theme-glass-light` 作用域。默认开。
   * 若外层（如 layout）已经加过，传 `false` 避免重复。
   */
  scoped?: boolean;
  /**
   * blob 数量。数据密集页面（表格、长列表）建议降到 1~2 减少 GPU 压力。
   * 默认 3（性能上限）。
   */
  blobs?: 1 | 2 | 3;
}

export function AuroraBackground({
  children,
  className,
  grain = true,
  grid = false,
  scoped = true,
  blobs = 3,
}: AuroraBackgroundProps) {
  // 优雅处理 SSR：如果 ThemeProvider 不可用（SSR 阶段），默认浅色主题
  let theme: 'light' | 'dark' = 'light';
  try {
    const context = useTheme();
    theme = context.theme;
  } catch {
    // SSR 或 ThemeProvider 不可用时，使用默认主题
    theme = 'light';
  }

  return (
    <div
      className={cn(
        // 应用对应主题的 glass 作用域和 aurora 容器类
        scoped && (theme === 'dark' ? 'theme-glass' : 'theme-glass-light aurora-root-light'),
        grain && 'aurora-grain',
        grid && 'aurora-grid',
        className,
      )}
    >
      <div className="aurora-layer" aria-hidden="true">
        <div className="aurora-blob aurora-blob-1" />
        {blobs >= 2 && <div className="aurora-blob aurora-blob-2" />}
        {blobs >= 3 && <div className="aurora-blob aurora-blob-3" />}
      </div>
      {children}
    </div>
  );
}
