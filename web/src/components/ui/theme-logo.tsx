'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface ThemeLogoProps {
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
}

/**
 * 主题自适应 Logo
 * - 深色主题：logo-new.png（深色 logo）
 * - 浅色主题：logo-light.png（粉色 logo）
 *
 * 通过读取 html.dark/light class 来判断主题，避免依赖 ThemeProvider
 */
export function ThemeLogo({
  width = 28,
  height = 28,
  className,
  priority = false,
}: ThemeLogoProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // 读取 html 元素的 class 来判断主题（检查 theme-glass 类）
    const updateTheme = () => {
      const isDark = document.documentElement.classList.contains('theme-glass');
      setTheme(isDark ? 'dark' : 'light');
    };

    updateTheme();

    // 监听 html class 变化
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  // 避免服务端渲染时的闪烁，先显示浅色 logo
  const logoSrc = mounted && theme === 'dark' ? '/logo-new.png' : '/logo-light.png';

  return (
    <Image
      src={logoSrc}
      alt="硅基人才平台"
      width={width}
      height={height}
      className={cn('shrink-0 rounded', className)}
      priority={priority}
    />
  );
}
