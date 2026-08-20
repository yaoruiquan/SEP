import type { Metadata } from "next";
import { PillNav } from "./_components/pill-nav";
import { SiteFooter } from "./_components/site-footer";
import { RevealBoot } from "./_components/reveal-boot";
import { AuroraBackground } from "@/components/ui/aurora-background";

export const metadata: Metadata = {
  title: "硅基人才平台 · 让公司从个体提效到组织提效",
  description:
    "让公司从个体提效到组织提效：把 Agent、RPA、技能与 AI 应用包装成可订阅、可授权、可追踪的硅基员工，与碳基团队协同工作。",
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
