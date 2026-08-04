'use client';

import { Moon, Sun } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTheme } from '@/lib/theme-provider';
import { Button } from './button';

function ThemeToggleComponent() {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-9 w-9"
      aria-label={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </Button>
  );
}

// 禁用 SSR，避免 hydration mismatch
export const ThemeToggle = dynamic(() => Promise.resolve(ThemeToggleComponent), {
  ssr: false,
});
