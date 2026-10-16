import { redirect } from 'next/navigation';

export default async function KnowledgeAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/knowledge/${id}`);
}
