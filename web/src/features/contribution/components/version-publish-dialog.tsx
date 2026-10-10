'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function VersionPublishDialog({ open, onOpenChange }: {
  capabilityId: string; parentVersionId?: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent glass>
    <DialogHeader><DialogTitle>SKILL 版本只读</DialogTitle><DialogDescription>已有技能的正文、包替换和新版本由客户端维护，Web 不再创建版本。</DialogDescription></DialogHeader>
    <DialogFooter><Button variant="glass" onClick={() => onOpenChange(false)}>关闭</Button></DialogFooter>
  </DialogContent></Dialog>;
}
