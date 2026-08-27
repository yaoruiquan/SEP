'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

const MIN_LENGTH = 5;

/**
 * 驳回原因输入。
 *
 * 替换重构前的 window.prompt：原生弹窗既和玻璃质感割裂，也无法区分
 * 「用户点了取消」和「用户提交了空串」，更不能做长度校验。
 */
export function RejectReasonDialog({
  open,
  capabilityName,
  loading,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  capabilityName: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_LENGTH;
  const canSubmit = trimmed.length >= MIN_LENGTH && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent glass className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gtext-primary">
            <span className="grid h-7 w-7 place-items-center rounded-glass-md border border-gdanger/28 bg-gdanger/10 text-gdanger">
              <Ban className="h-3.5 w-3.5" />
            </span>
            驳回「{capabilityName}」
          </DialogTitle>
          <DialogDescription className="mt-2 text-gtext-muted">
            驳回原因会展示在贡献者的发布流程里，请说明需要修改什么，方便对方直接修正后重新提交。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-1">
          <Textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：输入结构缺少必填字段说明，边界条件需要补充异常处理方式。"
            className="min-h-28 rounded-glass-md border-glassline bg-glass-2 text-gtext-primary placeholder:text-gtext-muted focus-visible:ring-gbrand-ring"
          />
          <p className="mt-2 text-[11px] text-gtext-muted">
            {tooShort ? `还需要 ${MIN_LENGTH - trimmed.length} 个字` : `${trimmed.length} / 至少 ${MIN_LENGTH} 个字`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="glass" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button variant="glass-danger" loading={loading} disabled={!canSubmit} onClick={() => onConfirm(trimmed)}>
            确认驳回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
