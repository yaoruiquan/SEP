import { useAuthStore } from "@/lib/auth-store";

/**
 * Auth hook - access current user and enterprise.
 */
export function useAuth() {
  const { user, enterprise, roleInEnterprise } = useAuthStore();

  return {
    user,
    enterprise,
    roleInEnterprise,
    isAdmin: roleInEnterprise === "ENTERPRISE_ADMIN",
  };
}
