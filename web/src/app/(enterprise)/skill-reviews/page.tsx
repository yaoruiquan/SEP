import { redirect } from 'next/navigation';

export default async function SkillReviewsPage({ searchParams }: {
  searchParams: Promise<{ capabilityId?: string | string[] }>;
}) {
  const { capabilityId } = await searchParams;
  redirect(typeof capabilityId === 'string' && capabilityId
    ? `/capabilities/${encodeURIComponent(capabilityId)}?tab=changes`
    : '/capabilities');
}
