'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * 滚动进场包装器。
 *
 * 隐藏态定义在 globals.css 的 `html.js-reveal .reveal`，只有 <RevealBoot />
 * 把 `js-reveal` 加到 <html> 之后才生效。没有 JS 时内容默认可见，
 * 不会出现"整页 opacity:0"的 SEO / 无障碍事故。
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  /** 过渡延迟（ms），用于同排多个元素错落进场 */
  delay?: number;
  as?: 'div' | 'section' | 'li';
}) {
  const ref = useRef<HTMLElement>(null);
  // Tag 是三个标签的联合类型，直接渲染时 TS 会把 ref 收敛成三种 ref 的交集
  // （HTMLDivElement & HTMLLIElement & …），任何具体元素都不满足。
  // 收窄成 ElementType 后按运行时行为处理，ref 的实际类型由 useRef 保证。
  const Comp = Tag as React.ElementType;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 不支持 IntersectionObserver 的老浏览器：直接显示，不做动画
    if (typeof IntersectionObserver === 'undefined') {
      el.dataset.visible = 'true';
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.dataset.visible = 'true';
            io.disconnect(); // 一次性，不做退出动画
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Comp
      ref={ref}
      className={cn('reveal', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Comp>
  );
}
