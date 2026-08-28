'use client';

import { useTheme } from './theme-provider';

export type GlassScopeClass = 'glass-scope' | 'glass-scope-light';

/**
 * Radix Portal 浮层要用的玻璃令牌作用域 class。
 *
 * Portal 把内容挂到 <body>，跑出了 AuroraBackground 注入的
 * `.theme-glass` / `.theme-glass-light` 子树，玻璃令牌会全部丢失
 * （浮层退化成透明块）。浮层自己带上作用域 class 才能把令牌带过去。
 *
 * ⚠️ 深浅两套令牌挂在**两个不同的** class 上（见 globals.css 的
 * `.theme-glass, .glass-scope` 与 `.theme-glass-light, .glass-scope-light`）。
 * 写死 `.glass-scope` 会让浅色主题下的浮层拿到深色令牌 —— 灰玻璃 + 白字 +
 * indigo 品牌色，而页面是白底 + pink 品牌色，视觉上完全不是一个主题。
 */
export function useGlassScope(): GlassScopeClass {
  // ThemeProvider 在 SSR 与首次挂载前不提供 context（见 theme-provider.tsx），
  // 这里按浅色兜底 —— 与 AuroraBackground 的处理保持一致。
  // useTheme 内部就是 useContext，异常发生在它返回之后，Hook 调用顺序稳定。
  try {
    return useTheme().theme === 'dark' ? 'glass-scope' : 'glass-scope-light';
  } catch {
    return 'glass-scope-light';
  }
}
