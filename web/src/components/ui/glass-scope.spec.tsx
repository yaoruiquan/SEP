import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent } from './dialog';

// jsdom 没有 matchMedia，而 DialogContent 走 usePrefersReducedMotion。
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

// Portal 浮层的令牌作用域必须跟随主题：深色 .glass-scope / 浅色 .glass-scope-light。
// 写死 .glass-scope 时浅色页面上的弹窗会拿到深色令牌（灰玻璃 + 白字 + indigo
// 品牌色），这个测试就是拦那次回归的。
const theme = { current: 'light' as 'light' | 'dark' };

vi.mock('@/lib/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: theme.current, toggleTheme: vi.fn() }),
}));

const renderGlassDialog = () =>
  render(
    <Dialog open>
      <DialogContent glass>
        <span>正文</span>
      </DialogContent>
    </Dialog>,
  );

/** 浮层内容元素 —— .glass-elevated 就挂在它身上。 */
const surface = () => document.querySelector('.glass-elevated') as HTMLElement;

describe('Portal 玻璃作用域', () => {
  beforeEach(() => {
    theme.current = 'light';
  });

  it('浅色主题下浮层带 glass-scope-light', () => {
    renderGlassDialog();
    expect(screen.getByText('正文')).toBeInTheDocument();
    expect(surface().classList.contains('glass-scope-light')).toBe(true);
    expect(surface().classList.contains('glass-scope')).toBe(false);
  });

  it('深色主题下浮层带 glass-scope', () => {
    theme.current = 'dark';
    renderGlassDialog();
    expect(surface().classList.contains('glass-scope')).toBe(true);
    expect(surface().classList.contains('glass-scope-light')).toBe(false);
  });

  it('遮罩层与内容层用同一套作用域', () => {
    renderGlassDialog();
    const overlay = document.querySelector('.bg-gbg-deep\\/80') as HTMLElement;
    expect(overlay.classList.contains('glass-scope-light')).toBe(true);
  });

  it('非玻璃浮层不注入任何作用域 class', () => {
    render(
      <Dialog open>
        <DialogContent>
          <span>浅色遗留弹窗</span>
        </DialogContent>
      </Dialog>,
    );
    const content = screen.getByText('浅色遗留弹窗').parentElement as HTMLElement;
    expect(content.className).not.toMatch(/glass-scope/);
  });
});
