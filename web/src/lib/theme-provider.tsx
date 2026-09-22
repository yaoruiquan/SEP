'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem('theme') as Theme | null;
    return (stored === 'light' || stored === 'dark') ? stored : 'light';
  });
  const [mounted, setMounted] = useState(false);

  // 挂载标记不需要在 effect 里设置，直接用 useEffect 的存在即表示已挂载
  if (typeof window !== 'undefined' && !mounted) {
    setMounted(true);
  }

  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;

    // dark 主题使用 theme-glass 类，light 主题移除该类
    if (theme === 'dark') {
      root.classList.add('theme-glass');
    } else {
      root.classList.remove('theme-glass');
    }

    localStorage.setItem('theme', theme);

    // 动态更新 favicon
    const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (favicon) {
      favicon.href = theme === 'dark' ? '/favicon-dark.ico' : '/favicon-light.png';
    }
  }, [theme, mounted]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // 避免服务端渲染时闪烁
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
