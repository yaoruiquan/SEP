'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  LayoutDashboard,
  Users,
  GitBranch,
  MonitorPlay,
  Boxes,
  Store,
  Settings,
  LogOut,
  Menu,
  X,
  BarChart3,
  Shield,
  BookOpen,
  ListTodo,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Cpu,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/status-dot';
import { AuroraBackground } from '@/components/ui/aurora-background';
import { ThemeLogo } from '@/components/ui/theme-logo';
import { nav } from '@/locales/zh-CN';
import { cn } from '@/lib/utils';
import { NavItem, type NavLink } from './nav-item';
import { ShellTopbar, type CrumbMap } from './shell-topbar';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/features/auth/use-auth';
import { NotificationBell } from '@/components/notification-bell';

/** 单条导航项，可单独标记仅管理员可见 */
type GuardedNavLink = NavLink & { adminOnly?: boolean };

interface NavGroup {
  title?: string;
  links: GuardedNavLink[];
  /** 整组仅企业管理员可见；不设则看各 link 自己的 adminOnly */
  adminOnly?: boolean;
}

/**
 * 侧边栏分组。
 *
 * 过滤原则：**能看到的页面 = 在那儿至少能做一件事**。
 * 普通成员看不到「组织」组，不是怕他看，而是部门/成员的增删改都要
 * 企业管理员权限，进去除了看树什么都做不了，不如不给入口。
 *
 * ⚠️ 这是体验优化，**不是安全措施** —— roleInEnterprise 存在浏览器里，
 * 用户改得动。真正拦人的是后端的 assertEnterpriseAdmin。
 */
const NAV_GROUPS: NavGroup[] = [
  {
    links: [
      { href: '/dashboard', label: nav.dashboard, icon: LayoutDashboard, exact: true },
    ],
  },
  {
    title: '组织',
    adminOnly: true,
    links: [
      { href: '/departments', label: nav.departments, icon: GitBranch },
      // 碳基员工（真人成员），与下方「硅基员工」组形成对比
      { href: '/members', label: nav.members, icon: Users },
    ],
  },
  {
    title: '硅基员工',
    links: [
      // 使用者视角：我被授权使用的硅基员工。普通成员的核心页面
      { href: '/my-employees', label: nav.myEmployees, icon: MonitorPlay },
      // 管理视角：雇佣关系（买） + 员工授权（分配给碳基员工）
      { href: '/subscriptions', label: nav.subscriptions, icon: Users, adminOnly: true },
      { href: '/instances', label: nav.instances, icon: Boxes, adminOnly: true },
    ],
  },
  {
    // 独立成组、紧跟「硅基员工」：逛市场是「招人」，上一组是「管已招的人」，
    // 相邻但不同层级 —— 不塞进上一组，避免与「我的员工/订阅/实例」混为一类
    links: [{ href: '/marketplace', label: nav.marketplace, icon: Store }],
  },
  {
    title: '工作',
    links: [
      { href: '/chat', label: nav.chat, icon: MessageSquare },
      { href: '/tasks', label: nav.tasks, icon: ListTodo },
    ],
  },
  {
    title: '协作',
    links: [
      { href: '/permissions', label: nav.permissions, icon: Shield },
      // 决策 2：此处保留为批量维护入口，授权主入口在硅基员工详情页
      { href: '/knowledge', label: nav.knowledge, icon: BookOpen },
    ],
  },
  {
    title: '账务',
    links: [
      { href: '/usage', label: nav.usage, icon: BarChart3 },
      { href: '/analytics/cost', label: nav.costAnalytics, icon: BarChart3, adminOnly: true },
    ],
  },
  {
    title: '设置',
    adminOnly: true,
    links: [{ href: '/settings/models', label: nav.modelConfig, icon: Cpu }],
  },
];

/** 顶栏面包屑用的「路径段 → 中文名」映射，从 NAV_GROUPS 推导 + 补上非导航路由 */
const CRUMBS: CrumbMap = {
  ...Object.fromEntries(
    NAV_GROUPS.flatMap((g) =>
      g.links.map((l) => [l.href.replace(/^\//, ''), l.label] as const),
    ),
  ),
  settings: '设置',
  models: '模型配置',
  chat: '对话',
  new: '新建',
  edit: '编辑',
};

export function EnterpriseShell({ children }: { children: React.ReactNode }) {
  const { user, enterprise, roleInEnterprise } = useAuthStore();
  const logout = useLogout();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = roleInEnterprise === 'ENTERPRISE_ADMIN';

  const statusDotStatus = 'offline' as const;

  // 先过滤整组，再过滤组内单项；两级都为空的组不渲染标题
  const groups = NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin)
    .map((g) => ({ ...g, links: g.links.filter((l) => !l.adminOnly || isAdmin) }))
    .filter((g) => g.links.length > 0);

  return (
    // 主题 B 极光（PRD §背景渐变配方）。blobs=2：企业端多为表格/长列表，
    // 少一层 80px blur 给内容区留 GPU 预算。
    <AuroraBackground blobs={2} className="flex h-screen">
      {/* Mobile menu button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-glass-sm border border-glassline bg-glass-2 text-gtext-primary backdrop-blur-glass-md lg:hidden"
        aria-label="Toggle menu"
      >
        {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Backdrop overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-gbg-deep/70 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-40',
          'glass-nav flex shrink-0 flex-col transition-all duration-300',
          'lg:translate-x-0',
          // 移动端：完全隐藏或显示
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          // 桌面端：折叠时宽度变窄
          collapsed ? 'lg:w-16' : 'w-60',
        )}
      >
        {/* Logo 区域 - 固定 64px 高度，与顶栏对齐 */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-glassline px-5">
          <div className="flex items-center gap-2 overflow-hidden">
            <ThemeLogo priority />
            {/* 显示企业名而非平台名 —— 多租户下让人一眼确认在哪家企业 */}
            {!collapsed && (
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gtext-primary">
                {enterprise?.name ?? '硅基人才平台'}
              </p>
            )}
          </div>
          {/* 桌面端折叠按钮 */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden shrink-0 rounded hover:bg-glass-2 p-1 lg:block"
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 text-gtext-secondary" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-gtext-secondary" />
            )}
          </button>
          {/* WebSocket 连接状态指示器 - 折叠时隐藏 */}
          {!collapsed && <StatusDot status={statusDotStatus} size="sm" />}
        </div>

        <nav className="flex-1 overflow-y-auto scroll-thin px-3 py-4">
          {groups.map((group, i) => (
            <div key={group.title ?? `g${i}`} className="mb-1">
              {group.title && !collapsed && (
                <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-gtext-muted">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.links.map((link) => (
                  <div key={link.href} onClick={() => setSidebarOpen(false)}>
                    <NavItem {...link} collapsed={collapsed} />
                  </div>
                ))}
              </div>
              {/* 分组分割线 */}
              {i < groups.length - 1 && (
                <div className="my-3 border-t border-glassline" />
              )}
            </div>
          ))}
        </nav>

        {/* 用户信息区域 - 底部固定 */}
        <div className="shrink-0 border-t border-glassline p-3">
          {!collapsed ? (
            <>
              <div className="mb-2 flex items-center gap-2 rounded-glass-sm border border-glassline bg-glass-2 px-2 py-2.5">
                <Avatar name={user?.name || user?.email || '用户'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gtext-primary">
                    {user?.name || '用户'}
                  </p>
                  <p className="truncate text-xs text-gtext-muted">{user?.email}</p>
                </div>
              </div>
              <div onClick={() => setSidebarOpen(false)}>
                <NavItem href="/settings" label={nav.personalSettings} icon={Settings} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 w-full justify-start text-gtext-secondary hover:bg-glass-2 hover:text-gtext-primary"
                onClick={() => logout.mutate()}
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => setSidebarOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-glass-sm hover:bg-glass-2"
                title="个人设置"
              >
                <Settings className="h-5 w-5 text-gtext-secondary" />
              </button>
              <button
                onClick={() => logout.mutate()}
                className="flex h-10 w-10 items-center justify-center rounded-glass-sm hover:bg-glass-2"
                title="退出登录"
              >
                <LogOut className="h-5 w-5 text-gtext-secondary" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* 内容区是滚动容器 —— sticky 顶栏必须是它的直接子元素才能吸住 */}
      <main className="flex-1 overflow-y-auto scroll-thin">
        <ShellTopbar
          crumbs={CRUMBS}
          rootLabel="工作台"
          rootHref="/dashboard"
          roleLabel={isAdmin ? '企业管理员' : '企业成员'}
          hamburgerGutter
        >
          <NotificationBell />
        </ShellTopbar>
        {children}
      </main>
    </AuroraBackground>
  );
}
