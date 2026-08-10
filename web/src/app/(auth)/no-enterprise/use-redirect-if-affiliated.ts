'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, defaultHomeFor } from '@/lib/auth-store';

/**
 * /no-enterprise 的反向守卫。
 *
 * 这页在 (auth) 组里，故没有 AuthGate —— 它必须自己处理两种不该停留的情况：
 *   ① 未登录：这页要显示当前账号邮箱、要调 accept-invitation，无 token 无意义
 *   ② 已有企业归属：常见于刚加入企业后按浏览器后退，此时页面会告诉一个
 *      有归属的人"你没有归属"，属于直接说错话
 *
 * 返回 true 表示正在跳转，调用方应渲染 loading 而不是正文。
 */
export function useRedirectIfAffiliated(): boolean {
  const router = useRouter();
  const { token, user, enterprise, hydrated } = useAuthStore();

  // 平台运营账号（全局 ADMIN）本就无企业归属，但他们的去处是运营端，
  // 不是这页 —— defaultHomeFor 已经编码了这个分派
  const shouldLeave = Boolean(token) && (Boolean(enterprise) || user?.role === 'ADMIN');
  const notLoggedIn = hydrated && !token;

  useEffect(() => {
    if (!hydrated) return;
    if (notLoggedIn) {
      router.replace('/login');
      return;
    }
    if (shouldLeave) {
      router.replace(defaultHomeFor(user, enterprise));
    }
  }, [hydrated, notLoggedIn, shouldLeave, user, enterprise, router]);

  return notLoggedIn || shouldLeave;
}
