'use client';

import type { SkillPackageParseResult } from '../../../../../backend/src/shared';

// 保留旧组件接口用于历史包展示；首次创建的上传仅在运营后台提供。
export function SkillPackageUpload({ value }: {
  value: SkillPackageParseResult | null; onChange: (value: SkillPackageParseResult | null) => void;
}) {
  return <div className="space-y-2 text-sm text-gtext-secondary">
    <p>SKILL 包由客户端维护，此处只读。</p>
    {value && <p className="break-all">{value.filename} · {value.fileCount} 个文件 · SHA256 {value.sha256}</p>}
  </div>;
}
