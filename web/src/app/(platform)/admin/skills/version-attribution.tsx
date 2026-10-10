import Link from 'next/link';
import { enterpriseVersionEmptyLabel, originalSubmitterLabel, type MonitorDetail, type MonitorRow } from './monitor';

type Props = { version: MonitorRow | MonitorDetail };

export function VersionAttribution({ version }: Props) {
  return (
    <dl className="space-y-2 text-xs">
      <div><dt className="text-gtext-muted">原提交人</dt><dd className="mt-1 break-words text-gtext-secondary">{originalSubmitterLabel(version)}</dd></div>
      <div><dt className="text-gtext-muted">审核发布人</dt><dd className="mt-1 break-words text-gtext-secondary">{version.enterprisePublisher?.name || version.enterprisePublisher?.id || '未标注'}</dd></div>
    </dl>
  );
}

export function EnterprisePublishedVersions({ version }: Props) {
  if (!version.enterprisePublishedVersions?.length) {
    return <p className="text-xs text-gtext-muted">{enterpriseVersionEmptyLabel(version)}</p>;
  }
  return (
    <ul className="space-y-2 text-xs">
      {version.enterprisePublishedVersions.map((published) => (
        <li key={published.id} className="break-words">
          <Link href={`/admin/skills/${published.id}`} className="text-gbrand-text hover:underline">企业发布版 v{published.version}</Link>
          <p className="mt-1 text-gtext-muted">{published.isEnterpriseCurrent ? '企业已启用' : '历史版本'}</p>
        </li>
      ))}
    </ul>
  );
}
