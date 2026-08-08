import { redirect } from 'next/navigation';

/** /settings → /settings/profile */
export default function SettingsIndexPage() {
  redirect('/settings/profile');
}
