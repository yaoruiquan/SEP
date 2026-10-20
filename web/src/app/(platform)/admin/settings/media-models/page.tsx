'use client';

import { redirect } from 'next/navigation';

export default function LegacyMediaModelsPage() {
  redirect('/admin/settings?tab=models&modelTab=image');
}
