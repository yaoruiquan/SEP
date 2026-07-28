import { AuthGate } from '@/components/auth-gate';
import { EnterpriseShell } from '@/components/shell/enterprise-shell';

/**
 * 企业管理台。要求有企业归属，但不限企业内角色 ——
 * 三种角色都能进，差异体现在侧边栏可见项与按钮可操作性
 * （见 enterprise-shell 的 LINKS 过滤）。
 */
export default function EnterpriseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate requireEnterprise>
      <EnterpriseShell>{children}</EnterpriseShell>
    </AuthGate>
  );
}
