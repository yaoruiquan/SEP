import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** false until the first refresh attempt on boot resolves */
  hydrated: boolean;
  setAuth: (token: string, user: AuthUser) => void;
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
  hydrated: false,
  setAuth: (token, user) => set({ token, user }),
  clear: () => set({ token: null, user: null }),
  setHydrated: () => set({ hydrated: true }),
}));

/** Non-hook accessors for use inside the plain apiClient module. */
export const authAccessor = {
  getToken: () => useAuthStore.getState().token,
  setAuth: (token: string, user: AuthUser) =>
    useAuthStore.getState().setAuth(token, user),
  clear: () => useAuthStore.getState().clear(),
};
