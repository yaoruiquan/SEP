import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeroDownloadMenu } from './hero-download-menu';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('HeroDownloadMenu', () => {
  it('opens on the first focus + click and toggles closed on a second click', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<HeroDownloadMenu />);
    const button = screen.getByRole('button', { name: /下载客户端/ });
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
  it('opens via keyboard and closes on Escape', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<HeroDownloadMenu />);
    const button = screen.getByRole('button', { name: /下载客户端/ });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
