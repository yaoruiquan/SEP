'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { SkillPackageUpload } from './skill-package-upload';
import { useCreateVersion } from '../use-contributions';
import type { SkillPackageParseResult } from '../../../../../backend/src/shared';

type Source = 'upload' | 'inline';

/**
 * 发布新版本。与创建能力共用同一套正文来源规则（上传包 / 在线编写），
 * 额外强制变更说明 —— 没有它审核人无从判断这一版改了什么，服务端也会拦。
 */
export function VersionPublishDialog({
  capabilityId,
  parentVersionId,
  open,
  onOpenChange,
}: {
  capabilityId: string;
  /** 派生自哪个版本。不传则由服务端回落到本作用域最新版本或当前公开版本。 */
  parentVersionId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateVersion(capabilityId);
  const [source, setSource] = useState<Source>('upload');
  const [pkg, setPkg] = useState<SkillPackageParseResult | null>(null);
  const [content, setContent] = useState('');
  const [changeSummary, setChangeSummary] = useState('');

  const close = (value: boolean) => {
    if (!value) {
      setSource('upload');
      setPkg(null);
      setContent('');
      setChangeSummary('');
    }
    onOpenChange(value);
  };

  const bodyReady = source === 'upload' ? Boolean(pkg) : content.trim().length >= 20;

  const submit = () => {
    if (!changeSummary.trim()) { toast.error('请填写变更说明'); return; }
    if (!bodyReady) {
      toast.error(source === 'upload' ? '请先上传 SKILL 包' : '正文至少需要 20 个字符');
      return;
    }
    create.mutate({
      changeSummary: changeSummary.trim(),
      ...(parentVersionId ? { parentVersionId } : {}),
      ...(source === 'upload' && pkg
        ? { packageSha256: pkg.sha256, packageFilename: pkg.filename }
        : { content: content.trim() }),
    }, {
      onSuccess: () => { toast.success('新版本草稿已创建', '接下来可以提交审核'); close(false); },
      onError: (error) => toast.error(error instanceof Error ? error.message : '创建失败，请稍后重试'),
    });
  };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent glass className="max-w-3xl overflow-hidden p-0">
      <DialogHeader className="border-b border-glassline px-6 py-5 pr-14">
        <DialogTitle className="text-gtext-primary">发布新版本</DialogTitle>
        <DialogDescription className="mt-1 max-w-xl text-gtext-muted">
          新版本先存为草稿，提交审核后由企业管理员或平台运营处理。已公开的能力也可以继续迭代。
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[min(520px,calc(100vh-260px))] overflow-y-auto px-6 py-5 scroll-thin">
        <label className="block text-sm text-gtext-secondary">
          变更说明
          <Textarea glass value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} placeholder="这一版改了什么、为什么改" className="mt-1.5 min-h-20 resize-y" />
        </label>
        <div className="mt-5 inline-flex items-center gap-1 rounded-glass-md border border-glassline bg-glass-2 p-1">
          <SourceTab active={source === 'upload'} onClick={() => setSource('upload')}>上传 SKILL 包</SourceTab>
          <SourceTab active={source === 'inline'} onClick={() => setSource('inline')}>在线编写</SourceTab>
        </div>
        <div className="mt-4">
          {source === 'upload' ? (
            <SkillPackageUpload value={pkg} onChange={setPkg} />
          ) : (
            <label className="block text-sm text-gtext-secondary">
              版本正文
              <Textarea glass value={content} onChange={(event) => setContent(event.target.value)} placeholder={'# 角色\n# 输入\n# 步骤\n# 输出\n# 边界条件'} className="mt-1.5 min-h-56 resize-y font-mono text-xs leading-6" />
              <span className="mt-2 block text-[11px] text-gtext-muted">{content.trim().length} / 至少 20 个字符</span>
            </label>
          )}
        </div>
      </div>
      <DialogFooter className="border-t border-glassline bg-glass-1/40 px-6 py-4">
        <Button variant="glass" onClick={() => close(false)}>取消</Button>
        <Button variant="glass-primary" loading={create.isPending} onClick={submit}>
          <Plus className="h-4 w-4" />
          创建版本草稿
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function SourceTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn('h-7 rounded-glass-pill px-3 text-xs transition-all duration-200', active ? 'bg-gbg-raised text-gtext-primary shadow-glass-sm' : 'text-gtext-muted hover:bg-glass-3 hover:text-gtext-secondary')}>{children}</button>;
}
