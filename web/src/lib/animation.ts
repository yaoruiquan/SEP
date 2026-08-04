import React from 'react';

/**
 * Animation Utilities
 *
 * 动画工具：支持 prefers-reduced-motion，提供安全的动画配置
 */

import { usePrefersReducedMotion } from './responsive';

/**
 * 动画配置类型
 */
export interface AnimationConfig {
  duration: number;
  delay?: number;
  easing?: string;
}

/**
 * 默认动画配置
 */
export const ANIMATION_PRESETS = {
  fast: { duration: 150 },
  normal: { duration: 300 },
  slow: { duration: 500 },
  page: { duration: 400, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  bounce: { duration: 600, easing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)' },
  elastic: { duration: 800, easing: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)' },
} as const;

/**
 * 获取适配用户偏好的动画配置
 *
 * 如果用户启用了 prefers-reduced-motion，返回零时长配置
 *
 * @example
 * ```tsx
 * const config = useAnimationConfig(ANIMATION_PRESETS.normal);
 * // 如果用户启用减弱动画，config.duration 将为 0
 * ```
 */
export function useAnimationConfig(config: AnimationConfig): AnimationConfig {
  const prefersReducedMotion = usePrefersReducedMotion();

  if (prefersReducedMotion) {
    return { ...config, duration: 0, delay: 0 };
  }

  return config;
}

/**
 * 安全的 CSS 过渡类名生成器
 *
 * 根据 prefers-reduced-motion 偏好自动调整过渡效果
 *
 * @example
 * ```tsx
 * const transitionClass = useSafeTransition('opacity', ANIMATION_PRESETS.normal);
 * <div className={transitionClass}>...</div>
 * ```
 */
export function useSafeTransition(
  property: string,
  config: AnimationConfig = ANIMATION_PRESETS.normal
): string {
  const prefersReducedMotion = usePrefersReducedMotion();

  if (prefersReducedMotion) {
    return '';
  }

  const { duration, easing = 'ease' } = config;
  return `transition-${property} duration-[${duration}ms] ${easing}`;
}

/**
 * 页面过渡动画配置
 *
 * 用于页面切换时的淡入淡出效果
 */
export const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: ANIMATION_PRESETS.page,
} as const;

/**
 * 模态框动画配置
 */
export const MODAL_TRANSITION = {
  overlay: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 200 },
  },
  content: {
    initial: { opacity: 0, scale: 0.95, y: 8 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: 8 },
    transition: { duration: 200, ease: 'easeOut' },
  },
} as const;

/**
 * 抽屉动画配置
 */
export const DRAWER_TRANSITION = {
  overlay: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 300 },
  },
  right: {
    initial: { x: '100%' },
    animate: { x: 0 },
    exit: { x: '100%' },
    transition: { duration: 300, ease: 'easeInOut' },
  },
  left: {
    initial: { x: '-100%' },
    animate: { x: 0 },
    exit: { x: '-100%' },
    transition: { duration: 300, ease: 'easeInOut' },
  },
  bottom: {
    initial: { y: '100%' },
    animate: { y: 0 },
    exit: { y: '100%' },
    transition: { duration: 300, ease: 'easeInOut' },
  },
} as const;

/**
 * Toast 通知动画配置
 */
export const TOAST_TRANSITION = {
  initial: { opacity: 0, y: -16, scale: 0.95 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.95 },
  transition: { duration: 200 },
} as const;

/**
 * 列表项动画配置
 *
 * 用于列表项的交错动画
 */
export function getStaggerConfig(index: number, baseDelay = 0) {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    return {
      initial: { opacity: 1, y: 0 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0 },
    };
  }

  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 200,
      delay: baseDelay + index * 50,
      ease: 'easeOut',
    },
  };
}

/**
 * 获取缓动函数
 */
export const EASINGS = {
  linear: 'linear',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  elastic: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
} as const;

/**
 * Spring 动画配置
 */
export const SPRING_CONFIGS = {
  stiff: { stiffness: 300, damping: 30 },
  gentle: { stiffness: 120, damping: 14 },
  slow: { stiffness: 80, damping: 10 },
  molasses: { stiffness: 40, damping: 8 },
  bounce: { stiffness: 200, damping: 10 },
} as const;

/**
 * CSS 动画类名助手
 *
 * 生成符合 Tailwind 规范的动画类名
 */
export function getAnimationClass(
  animation: 'fade-in' | 'fade-out' | 'slide-up' | 'slide-down' | 'scale-in' | 'scale-out',
  config: AnimationConfig = ANIMATION_PRESETS.normal
): string {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    return '';
  }

  const { duration } = config;
  const durationClass = `duration-[${duration}ms]`;

  const animationMap = {
    'fade-in': `animate-in fade-in ${durationClass}`,
    'fade-out': `animate-out fade-out ${durationClass}`,
    'slide-up': `animate-in slide-in-from-bottom ${durationClass}`,
    'slide-down': `animate-out slide-out-to-bottom ${durationClass}`,
    'scale-in': `animate-in zoom-in-95 ${durationClass}`,
    'scale-out': `animate-out zoom-out-95 ${durationClass}`,
  };

  return animationMap[animation];
}

/**
 * 滚动动画 Hook
 *
 * 元素进入视口时触发动画
 *
 * @example
 * ```tsx
 * const [ref, inView] = useScrollAnimation();
 * <div ref={ref} className={inView ? 'animate-fade-in' : 'opacity-0'}>
 *   内容
 * </div>
 * ```
 */
export function useScrollAnimation(threshold = 0.1): [
  React.RefObject<HTMLDivElement | null>,
  boolean
] {
  const [inView, setInView] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, [threshold]);

  return [ref, inView];
}

/**
 * 页面加载动画配置
 */
export const PAGE_LOAD_ANIMATION = {
  container: {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  },
  item: {
    initial: { opacity: 0, y: 12 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 400, ease: 'easeOut' },
    },
  },
} as const;

/**
 * 微交互动画类名
 */
export const MICRO_INTERACTIONS = {
  hover: 'transition-all duration-200 hover:scale-[1.02] hover:shadow-card-hover',
  press: 'transition-transform duration-100 active:scale-[0.98]',
  focus: 'transition-colors duration-200 focus:ring-2 focus:ring-primary focus:ring-offset-2',
  disabled: 'opacity-50 cursor-not-allowed',
} as const;
