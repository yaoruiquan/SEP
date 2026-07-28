import { MarketHeader } from '@/components/shell/market-header';

/**
 * 人才市场。**不加 AuthGate** —— 市场对未登录用户开放浏览，
 * 这是决策明确的（未登录用户能逛人才市场）。
 *
 * 需要登录的动作（订阅、创建实例）由各页面自己在点击时引导登录，
 * 而不是在进入页面时就拦截。
 */
export default function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <MarketHeader />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
