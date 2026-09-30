'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { SkillPackageUpload } from './skill-package-upload';
import { useCreateVersion } from '../use-contributions';
import type { SkillPackageParseResult } from '../../../../../backend/src/shared';

export function VersionPublishDialog({ capabilityId, parentVersionId, open, onOpenChange }: { capabilityId: string; parentVersionId?: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateVersion(capabilityId);
  const [pkg, setPkg] = useState<SkillPackageParseResult | null>(null);
  const [changeSummary, setChangeSummary] = useState('');

  const close = (value: boolean) => { if (!value) { setPkg(null); setChangeSummary(''); } onOpenChange(value); };
  const submit = () => {
    if (!changeSummary.trim()) { toast.error('请填写变更说明'); return; }
    if (!pkg) { toast.error('请先上传 SKILL ZIP 包'); return; }
    if (!pkg.validation.valid) { toast.error('SKILL ZIP 自动校验未通过，请更换文件'); return; }
    create.mutate({ changeSummary: changeSummary.trim(), ...(parentVersionId ? { parentVersionId } : {}), packageSha256: pkg.sha256, packageFilename: pkg.filename }, {
      onSuccess: () => { toast.success('新版本草稿已创建', '接下来可以提交审核'); close(false); },
      onError: (error) => toast.error(error instanceof Error ? error.message : '创建失败，请稍后重试'),
    });
  };

  return <Dialog open={open} onOpenChange={close}><DialogContent glass className="max-w-3xl overflow-hidden p-0"><DialogHeader className="border-b border-glassline px-6 py-5 pr-14"><DialogTitle className="text-gtext-primary">发布新版本</DialogTitle><DialogDescription className="mt-1 max-w-xl text-gtext-muted">上传新的 SKILL ZIP 包，先存为草稿，提交审核后再发布。</DialogDescription></DialogHeader><div className="max-h-[min(520px,calc(100vh-260px))] overflow-y-auto px-6 py-5 scroll-thin"><label className="block text-sm text-gtext-secondary">变更说明<Textarea glass value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} placeholder="这一版改了什么、为什么改" className="mt-1.5 min-h-20 resize-y" /></label><div className="mt-5"><SkillPackageUpload value={pkg} onChange={setPkg} /></div></div><DialogFooter className="border-t border-glassline bg-glass-1/40 px-6 py-4"><Button variant="glass" onClick={() => close(false)}>取消</Button><Button variant="glass-primary" disabled={!pkg?.validation.valid || !changeSummary.trim()} loading={create.isPending} onClick={submit}><Plus className="h-4 w-4" />创建版本草稿</Button></DialogFooter></DialogContent></Dialog>;
}
