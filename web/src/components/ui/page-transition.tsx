/**
 * PageTransition —— 路由切换时的淡入淡出。
 *
 * 治理决定（P3.2）：过渡要么全路由组都有、要么全无。"部分页面有动画、部分没有"
 * 比全无更糟 —— 用户会在不同入口看到不一致的切换手感。各路由组 layout 现在都挂这层。
 *
 * prefers-reduced-motion：framer 动画此前不尊重该偏好，前庭敏感用户会看到页面上下位移。
 * 这里用 framer 自带的 SSR-safe `useReducedMotion` 读偏好，命中时把位移与时长全部归零
 * （仍是同构切换，但视觉上瞬间到位、不晃）。
 *
 * className：默认 `flex h-full min-h-0 flex-col` —— 适配**高度受限的 shell**
 * （enterprise / platform / contribution：main 是 flex 子项，全高页如 /chat 要靠它撑满）。
 * 文档流路由组（market / auth / marketing：整页随文档滚动）传 `className=""`，
 * 让 motion.div 退化成普通块容器，不强加 flex 影响子页布局。
 */

'use client';

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { usePathname } from 'next/navigation';

interface PageTransitionProps {
  children: React.ReactNode;
  /** 包裹层 class。高度受限 shell 用默认值；文档流路由组传 ""。 */
  className?: string;
}

export function PageTransition({
  children,
  className = 'flex h-full min-h-0 flex-col',
}: PageTransitionProps) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  // 减弱动效：零位移、零时长，等同直接切换
  const shift = reducedMotion ? 0 : 20;
  const duration = reducedMotion ? 0 : 0.3;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: shift }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -shift }}
        transition={{ duration, ease: [0.4, 0, 0.2, 1] }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
