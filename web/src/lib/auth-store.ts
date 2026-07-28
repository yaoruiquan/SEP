import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  /** 全局角色。ADMIN = 平台运营人员，与企业内角色是两套体系。 */
  role: string;
}

export interface AuthEnterprise {
  id: string;
  name: string;
}

/** 企业内角色。平台运营人员不属于任何企业，故可为 null。 */
export type EnterpriseRole = 'ENTERPRISE_ADMIN' | 'DEPT_MANAGER' | 'MEMBER';

/**
 * 后端 /auth/login · /auth/register · /auth/refresh 的统一响应形状。
 * enterprise 与 roleInEnterprise 是 user 的**兄弟字段**而非嵌套在 user 内，
 * 这里保持与后端 AuthResponse 一致，避免两侧形状漂移。
 */
export interface AuthPayload {
  token: string;
  user: AuthUser;
  enterprise: AuthEnterprise | null;
  roleInEnterprise: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  enterprise: AuthEnterprise | null;
  roleInEnterprise: string | null;
  /** false until the first refresh attempt on boot resolves */
  hydrated: boolean;
  setAuth: (payload: AuthPayload) => void;
  clear: () => void;
  setHydrated: () => void;
}

/**
 * Access token lives in memory only (never localStorage) per the auth design.
 * The refresh token is an httpOnly cookie the backend sets; on reload we call
 * GET /auth/refresh to rehydrate this store.
 */
export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  enterprise: null,
  roleInEnterprise: null,
  hydrated: false,
  setAuth: ({ token, user, enterprise, roleInEnterprise }) =>
    set({ token, user, enterprise, roleInEnterprise }),
  clear: () =>
    set({ token: null, user: null, enterprise: null, roleInEnterprise: null }),
  setHydrated: () => set({ hydrated: true }),
}));

/** Non-hook accessors for use inside the plain apiClient module. */
export const authAccessor = {
  getToken: () => useAuthStore.getState().token,
  setAuth: (payload: AuthPayload) => useAuthStore.getState().setAuth(payload),
  clear: () => useAuthStore.getState().clear(),
};

/**
 * 登录后的默认落地页。
 *
 * 平台运营人员（全局 ADMIN）不属于任何企业，进运营端；
 * 有企业归属的进企业台；两者都不是的只能逛市场
 * —— 理论上注册流程保证了每个普通账号都有企业，
 * 但历史数据或后端异常时不该白屏，故给市场兜底。
 */
export function defaultHomeFor(
  user: AuthUser | null,
  enterprise: AuthEnterprise | null,
): string {
  if (user?.role === 'ADMIN') return '/admin';
  if (enterprise) return '/dashboard';
  return '/marketplace';
}
