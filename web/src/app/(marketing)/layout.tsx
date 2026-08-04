import type { Metadata } from 'next';
import { PillNav } from './_components/pill-nav';
import { SiteFooter } from './_components/site-footer';
import { RevealBoot } from './_components/reveal-boot';
import { AuroraBackground } from '@/components/ui/aurora-background';

export const metadata: Metadata = {
  title: '硅基人才平台 · 订阅数字员工，像雇佣真人一样简单',
  description:
    '企业级 AI 人才平台：把 Agent、RPA、技能与 AI 应用包装成可招聘、可管理、可审计的数字员工。156 位数字员工覆盖数据、财务、内容、客服等 12 个职能。',
};

/**
 * 官网落地页外壳（PRD §7）。
 *
 * 使用 AuroraBackground 组件自动响应主题切换。
 * min-h-dvh 保证短页面时下方不会露出 body 的浅色底。
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuroraBackground className="min-h-dvh">
      <RevealBoot />
      <PillNav />
      <main>{children}</main>
      <SiteFooter />
    </AuroraBackground>
  );
}
