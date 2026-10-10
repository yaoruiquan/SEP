import { redirect } from 'next/navigation';

/** 兼容旧技能库书签，统一进入企业技能查看与审核入口。 */
export default function EnterpriseSkillsPage() {
  redirect('/capabilities');
}
