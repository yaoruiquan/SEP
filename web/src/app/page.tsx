import { redirect } from 'next/navigation';

/**
 * 根路径进人才市场，而非登录页 —— 市场是公开的门面，
 * 先让人看到有哪些员工可用，再引导注册。
 * 已登录用户由市场顶栏提供回控制台的入口。
 */
export default function RootPage() {
  redirect('/marketplace');
}
