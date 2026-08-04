import Link from 'next/link';
import { Bot } from 'lucide-react';

const COLUMNS = [
  {
    title: '产品',
    links: [
      { label: '员工市场', href: '/marketplace' },
      { label: '功能特性', href: '#features' },
      { label: '定价方案', href: '#pricing' },
      { label: '更新日志', href: '/changelog' },
    ],
  },
  {
    title: '解决方案',
    links: [
      { label: '数据分析', href: '/marketplace?fn=data' },
      { label: '财务对账', href: '/marketplace?fn=finance' },
      { label: '内容运营', href: '/marketplace?fn=content' },
      { label: '客户服务', href: '/marketplace?fn=cs' },
    ],
  },
  {
    title: '开发者',
    links: [
      { label: 'API 文档', href: '/docs/api' },
      { label: '能力接入', href: '/docs/capability' },
      { label: '贡献者中心', href: '/contributor' },
      { label: '状态页', href: '/status' },
    ],
  },
  {
    title: '公司',
    links: [
      { label: '关于我们', href: '/about' },
      { label: '联系销售', href: '/contact' },
      { label: '加入我们', href: '/careers' },
      { label: '博客', href: '/blog' },
    ],
  },
] as const;

const LEGAL = [
  { label: '服务条款', href: '/terms' },
  { label: '隐私政策', href: '/privacy' },
  { label: '安全说明', href: '/security' },
] as const;

/** 页脚（PRD §7.10）。5 列布局：品牌 + 4 组导航。 */
export function SiteFooter() {
  return (
    <footer className="border-t border-glassline px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-5">
          {/* 品牌列 */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-glass-md bg-gbrand"
                aria-hidden
              >
                <Bot className="h-4 w-4 text-white" />
              </span>
              <span className="text-sm font-semibold text-gtext-primary">硅基人才平台</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-gtext-muted">
              把 AI 能力包装成可招聘、可管理、可审计的数字员工。
            </p>
          </div>

          {COLUMNS.map(({ title, links }) => (
            <nav key={title} aria-label={title}>
              <h2 className="mb-4 text-sm font-semibold text-gtext-primary">{title}</h2>
              <ul className="space-y-2.5">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="text-sm text-gtext-muted transition-colors hover:text-gtext-primary"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col-reverse items-center justify-between gap-4 border-t border-glassline pt-8 sm:flex-row">
          <p className="text-xs text-gtext-disabled">
            © {new Date().getFullYear()} 硅基人才平台. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {LEGAL.map(({ label, href }) => (
              <li key={label}>
                <Link
                  href={href}
                  className="text-xs text-gtext-muted transition-colors hover:text-gtext-primary"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
