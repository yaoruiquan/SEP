'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useAuthorVersion, useUpdateVersion } from '../use-contributions';

/**
 * 作者改自己草稿的正文。
 *
 * 不复用 /skills/[versionId]/edit —— 那是企业租户改「自己订阅的技能」的界面，
 * 读写都走 /enterprise/skill-versions/*，要求成员持有该能力的订阅授权。
 * 刚贡献的能力没有任何员工绑定，作者点进去只会拿到 403。
 */
export function VersionEditDialog({
  capabilityId,
  versionId,
  onOpenChange,
}: {
  capabilityId: string;
  /** 空串表示关闭。 */
  versionId: string;
  onOpenChange: (versionId: string) => void;
}) {
  const open = Boolean(versionId);
  const query = useAuthorVersion(open ? versionId : '');
  const update = useUpdateVersion(capabilityId);
  const [content, setContent] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [dirty, setDirty] = useState(false);

  // 正文到了再灌进编辑器，但不要覆盖用户已经改过的内容
  useEffect(() => {
    if (!query.data || dirty) return;
    setContent(query.data.content);
    setChangeSummary(query.data.changeSummary ?? '');
  }, [query.data, dirty]);

  const close = () => {
    setContent('');
    setChangeSummary('');
    setDirty(false);
    onOpenChange('');
  };

  const submit = () => {
    if (content.trim().length < 20) { toast.error('正文至少需要 20 个字符'); return; }
    update.mutate({ versionId, content: content.trim(), changeSummary: changeSummary.trim() || undefined }, {
      onSuccess: () => { toast.success('已保存', '接下来可以提交审核'); close(); },
      onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败，请稍后重试'),
    });
  };

  return <Dialog open={open} onOpenChange={(value) => !value && close()}>
    <DialogContent glass className="max-w-3xl overflow-hidden p-0">
      <DialogHeader className="border-b border-glassline px-6 py-5 pr-14">
        <DialogTitle className="text-gtext-primary">
          编辑版本{query.data ? ` v${query.data.version}` : ''}
        </DialogTitle>
        <DialogDescription className="mt-1 text-gtext-muted">
          只有草稿和被驳回的版本可以改。保存后需要重新提交审核。
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[min(520px,calc(100vh-260px))] overflow-y-auto px-6 py-5 scroll-thin">
        {query.isLoading ? (
          <CenteredSpinner label="加载版本正文..." />
        ) : query.isError || !query.data ? (
          <EmptyState title="正文加载失败" description="请关闭后重试。" />
        ) : (
          <div className="grid gap-4">
            <label className="block text-sm text-gtext-secondary">
              变更说明
              <Textarea glass value={changeSummary} onChange={(event) => { setDirty(true); setChangeSummary(event.target.value); }} placeholder="这一版改了什么、为什么改" className="mt-1.5 min-h-20 resize-y" />
            </label>
            <label className="block text-sm text-gtext-secondary">
              版本正文
              <Textarea glass value={content} onChange={(event) => { setDirty(true); setContent(event.target.value); }} className="mt-1.5 min-h-72 resize-y font-mono text-xs leading-6" />
              <span className="mt-2 block text-[11px] text-gtext-muted">{content.trim().length} / 至少 20 个字符</span>
            </label>
          </div>
        )}
      </div>
      <DialogFooter className="border-t border-glassline bg-glass-1/40 px-6 py-4">
        <Button variant="glass" onClick={close}>取消</Button>
        <Button variant="glass-primary" loading={update.isPending} disabled={!query.data} onClick={submit}>
          <Save className="h-4 w-4" />
          保存
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
