'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { useAuthorVersion } from '../use-contributions';

// 兼容旧入口，只读取原版本，不提供正文保存能力。
export function VersionEditDialog({ versionId, onOpenChange }: {
  capabilityId: string; versionId: string; onOpenChange: (versionId: string) => void;
}) {
  const query = useAuthorVersion(versionId);
  return <Dialog open={Boolean(versionId)} onOpenChange={(open) => !open && onOpenChange('')}>
    <DialogContent glass className="max-w-3xl">
      <DialogHeader><DialogTitle>版本正文（只读）</DialogTitle><DialogDescription>已有 SKILL 请通过客户端修改并上传新版本。</DialogDescription></DialogHeader>
      {query.isLoading ? <CenteredSpinner label="加载版本正文..." /> : query.data ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6">{query.data.content}</pre> : <EmptyState title="正文加载失败" />}
      <DialogFooter><Button variant="glass" onClick={() => onOpenChange('')}>关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
