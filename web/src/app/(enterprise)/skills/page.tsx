import { redirect } from 'next/navigation';

/**
 * Compatibility route for existing bookmarks and employee-detail links.
 * Skill version management is being consolidated into the capability center.
 */
export default function EnterpriseSkillsPage() {
  redirect('/contributions');
}
