'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { LocalSkillScanner } from './local-skill-scanner';
import { useCreateVersion, useUploadSkillPackage } from '../use-contributions';
import type { SkillPackageParseResult } from '../../../../../backend/src/shared';

export function VersionPublishDialog({ capabilityId, parentVersionId, open, onOpenChange }: { capabilityId: string; parentVersionId?: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateVersion(capabilityId);
  const upload = useUploadSkillPackage();
  const [pkg, setPkg] = useState<SkillPackageParseResult | null>(null);
  const [changeSummary, setChangeSummary] = useState('');

  const acceptPackage = (file: File) => {
    upload.mutate(file, {
      onSuccess: setPkg,
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Skill 包解析失败'),
    });
  };

  const close = (value: boolean) => { if (!value) { setPkg(null); setChangeSummary(''); } onOpenChange(value); };
  const submit = () => {
    if (!changeSummary.trim()) { toast.error('请填写变更说明'); return; }
    if (!pkg) { toast.error('请先使用本机 CLI 扫描并确认一个 Skill'); return; }
    create.mutate({ changeSummary: changeSummary.trim(), ...(parentVersionId ? { parentVersionId } : {}), packageSha256: pkg.sha256, packageFilename: pkg.filename }, {
      onSuccess: () => { toast.success('新版本草稿已创建', '接下来可以提交审核'); close(false); },
      onError: (error) => toast.error(error instanceof Error ? error.message : '创建失败，请稍后重试'),
    });
  };

  return <Dialog open={open} onOpenChange={close}><DialogContent glass className="max-w-3xl overflow-hidden p-0"><DialogHeader className="border-b border-glassline px-6 py-5 pr-14"><DialogTitle className="text-gtext-primary">发布新版本</DialogTitle><DialogDescription className="mt-1 max-w-xl text-gtext-muted">新版本只能从本机扫描到的 Skill 导入，先存为草稿，提交审核后再发布。</DialogDescription></DialogHeader><div className="max-h-[min(520px,calc(100vh-260px))] overflow-y-auto px-6 py-5 scroll-thin"><label className="block text-sm text-gtext-secondary">变更说明<Textarea glass value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} placeholder="这一版改了什么、为什么改" className="mt-1.5 min-h-20 resize-y" /></label><div className="mt-5"><LocalSkillScanner onPackaged={acceptPackage} /></div>{pkg && <p className="mt-3 rounded-glass-md border border-gsuccess/30 bg-gsuccess/10 p-3 text-xs text-gsuccess">已确认 {pkg.filename} · sha256 {pkg.sha256.slice(0, 12)}…</p>}</div><DialogFooter className="border-t border-glassline bg-glass-1/40 px-6 py-4"><Button variant="glass" onClick={() => close(false)}>取消</Button><Button variant="glass-primary" loading={create.isPending} onClick={submit}><Plus className="h-4 w-4" />创建版本草稿</Button></DialogFooter></DialogContent></Dialog>;
}
