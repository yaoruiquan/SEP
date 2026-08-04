'use client';

import { useEffect } from 'react';

/**
 * 给 <html> 加上 `js-reveal`，激活 globals.css 里 `html.js-reveal .reveal` 的隐藏态。
 *
 * 为什么不直接在 CSS 里写 `.reveal { opacity: 0 }`：
 * 那样在 JS 失败 / 被禁用 / 首屏 hydration 前，整页内容都是不可见的 —— 对
 * 爬虫和读屏用户等于白屏。反过来做（JS 先声明"我能负责显示"）永远安全。
 */
export function RevealBoot() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('js-reveal');
    return () => root.classList.remove('js-reveal');
  }, []);

  return null;
}
