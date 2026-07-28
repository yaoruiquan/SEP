'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  useAuthStore,
  defaultHomeFor,
  type EnterpriseRole,
} from '@/lib/auth-store';
import { CenteredSpinner } from '@/components/ui/feedback';

/**
 * 包裹需要登录的路由组。等 boot 时的 refresh 落定后再判断，
 * 未登录送去 /login，权限不符送去该账号真正能进的首页。
 *
 * 全局角色（ADMIN = 平台运营）与企业内角色是**两套体系**：
 * 运营人员不属于任何企业，企业成员的全局 role 是 USER。
 * 故两个守卫参数彼此独立，不要合并成一个 role 列表。
 *
 * ⚠️ 这里的角色判断**仅为体验优化**（不展示进不去的页面、少一次
 * 失败请求）。真正的权限拦截在后端 —— 前端 store 可被用户改写，
 * 任何"因为前端挡了所以后端不用挡"的推论都是错的。
 */
export function AuthGate({
  children,
  /** 要求全局角色（平台运营端用）*/
  requireGlobalRole,
  /** 要求有企业归属（企业管理台用）*/
  requireEnterprise = false,
  /** 要求企业内角色属于其中之一，留空则不限 */
  requireEnterpriseRole,
}: {
  children: React.ReactNode;
  requireGlobalRole?: 'ADMIN';
  requireEnterprise?: boolean;
  requireEnterpriseRole?: EnterpriseRole[];
}) {
  const router = useRouter();
  const { token, user, enterprise, roleInEnterprise, hydrated } =
    useAuthStore();

  const globalRoleOk = !requireGlobalRole || user?.role === requireGlobalRole;
  const enterpriseOk = !requireEnterprise || Boolean(enterprise);
  const enterpriseRoleOk =
    !requireEnterpriseRole ||
    (roleInEnterprise !== null &&
      requireEnterpriseRole.includes(roleInEnterprise as EnterpriseRole));
  const allowed = globalRoleOk && enterpriseOk && enterpriseRoleOk;

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!allowed) {
      router.replace(defaultHomeFor(user, enterprise));
    }
  }, [hydrated, token, allowed, user, enterprise, router]);

  if (!hydrated || !token) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <CenteredSpinner label="加载中…" />
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <CenteredSpinner label="正在跳转…" />
      </div>
    );
  }
  return <>{children}</>;
}
