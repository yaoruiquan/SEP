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
  return (
    <span className={cn('relative block shrink-0 overflow-hidden rounded', className)} style={{ width, height }} aria-hidden="true">
      <Image
        src="/logo-light.png"
        alt=""
        width={width}
        height={height}
        unoptimized
        className="theme-logo-light absolute inset-0 h-full w-full object-contain"
        priority={priority}
      />
      <Image
        src="/logo-new.png"
        alt=""
        width={width}
        height={height}
        unoptimized
        className="theme-logo-dark absolute inset-0 hidden h-full w-full object-contain"
        priority={priority}
      />
    </span>
  );
}
