'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/utils';

/** cuid / uuid 之类的路由参数段，面包屑里显示成「详情」而不是一串乱码 */
const ID_LIKE = /^(c[a-z0-9]{20,}|[0-9a-f-]{16,})$/i;

/**
 * 「路径段 → 中文名」映射（**按段**而非按完整 href 建键）。
 * 各 shell 从自己的导航配置里推导，见 enterprise-shell / platform-shell 的 CRUMBS。
 */
export type CrumbMap = Record<string, string>;

export interface ShellTopbarProps {
  /** 路径段到中文名的映射 */
  crumbs: CrumbMap;
  /** 面包屑根节点文案。导航里叫「仪表盘」，面包屑根上通常想叫别的 */
  rootLabel: string;
  /** 根节点链接，同时用于去重：与它同 href 的段不再重复渲染 */
  rootHref: string;
  /** 不进面包屑的路径段（如运营端的 'admin'，其角色由 rootLabel 承担） */
  skipSegments?: string[];
  /** 右上角角色标识，如「企业管理员」/「平台运营」。无则不渲染 */
  roleLabel?: string;
  /** 移动端汉堡按钮占位（企业端 lg 以下有汉堡，需要左侧留白） */
  hamburgerGutter?: boolean;
  /** 面包屑与用户区之间的自定义插槽 */
  children?: React.ReactNode;
}

/**
 * 企业端 / 运营端共用的玻璃顶栏（PRD Phase 4「顶栏玻璃化」）。
 *
 * sticky 生效的前提是它必须是滚动容器（shell 里的 <main>）的直接子元素 ——
 * 若挪进 children 内层某个 overflow 容器，sticky 会贴到那个容器上而非视口。
 *
 * 刻意**没有**搜索框和通知铃：后端既没有全局搜索接口也没有通知接口，
 * 摆两个点不动的控件比不摆更糟。等接口就位再加。
 */
export function ShellTopbar({
  crumbs,
  rootLabel,
  rootHref,
  skipSegments,
  roleLabel,
  hamburgerGutter,
  children,
}: ShellTopbarProps) {
  const pathname = usePathname();

  const segments = pathname.split('/').filter(Boolean);
  const trail: { href: string; label: string }[] = [
    { href: rootHref, label: rootLabel },
  ];

  segments.forEach((seg, i) => {
    if (skipSegments?.includes(seg)) return;
    const href = '/' + segments.slice(0, i + 1).join('/');
    // 根节点已经占了这一格（如企业端 /dashboard、运营端 /admin），别渲染两遍
    if (href === rootHref) return;
    trail.push({
      href,
      label: crumbs[seg] ?? (ID_LIKE.test(seg) ? '详情' : decodeURIComponent(seg)),
    });
  });

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3',
        'border-b border-glassline bg-glass-2 px-6 backdrop-blur-glass-md',
        hamburgerGutter && 'pl-16 lg:pl-6',
      )}
    >
      {/* 面包屑 */}
      <nav aria-label="面包屑" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1 text-sm">
          {trail.map((c, i) => {
            const last = i === trail.length - 1;
            return (
              <li key={c.href} className="flex min-w-0 items-center gap-1">
                {i > 0 && (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-gtext-disabled"
                    aria-hidden
                  />
                )}
                {last ? (
                  <span
                    aria-current="page"
                    className="truncate font-medium text-gtext-primary"
                  >
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={c.href}
                    className="truncate text-gtext-muted transition-colors hover:text-gtext-secondary"
                  >
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {children}

      {/* 主题切换按钮 */}
      <ThemeToggle />

      {/* 只放角色标识。头像 / 姓名 / 邮箱 / 退出都在侧栏底部，不在顶栏重复一遍 */}
      {roleLabel && (
        <span className="hidden shrink-0 rounded-glass-pill border border-glassline bg-glass-2 px-2.5 py-1 text-xs font-medium text-gtext-secondary sm:inline-block">
          {roleLabel}
        </span>
      )}
    </header>
  );
}
