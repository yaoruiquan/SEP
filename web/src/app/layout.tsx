import type { Metadata } from 'next';
import './globals.css';
import 'highlight.js/styles/github.css';
import { Providers } from '@/components/providers';
import NextTopLoader from 'nextjs-toploader';

export const metadata: Metadata = {
  title: '硅基人才平台 - Silicon Talent Platform',
  description: '订阅碳基员工，调度硅基能力 | 像招募团队一样订阅数字员工，用一句话驱动 Agent、RPA、技能与 AI 应用',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className="min-h-screen bg-background text-foreground antialiased"
        suppressHydrationWarning
      >
        <NextTopLoader
          color="#3b82f6"
          height={3}
          showSpinner={false}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
