'use client';

import { useParams, redirect } from 'next/navigation';
import Link from 'next/link';
import { useSkillVersionPreview } from '@/features/skill-version/use-skill-version';

/** 兼容旧编辑书签，加载授权信息后转到对应技能的只读版本页。 */
export default function SkillVersionEditPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const { data, isLoading, isError, error } = useSkillVersionPreview(versionId, 'enterprise');

  if (data && !isError) redirect(`/capabilities/${encodeURIComponent(data.capabilityId)}`);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <p className="text-sm text-gtext-secondary">{isLoading ? '正在打开只读技能详情…' : error instanceof Error ? error.message : '无法加载技能版本'}</p>
      <p className="text-xs text-gtext-muted">技能正文请在客户端修改，Web 用于查看、审核和启用版本。</p>
      <Link href="/capabilities" className="text-xs text-gbrand-text hover:underline">返回技能库</Link>
    </div>
  );
}
