'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DigitalEmployee, MarketEmployee } from '@/lib/types';

interface SubscriptionRequestModalProps {
  open: boolean;
  emp: DigitalEmployee | MarketEmployee | null;
  onClose: () => void;
  onSubmit: (data: { reason: string; requestedDays?: number }) => void;
  submitting?: boolean;
}

const DURATION_OPTIONS = [
  { label: '永久', value: undefined },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
  { label: '180 天', value: 180 },
  { label: '365 天', value: 365 },
];

export function SubscriptionRequestModal({
  open,
  emp,
  onClose,
  onSubmit,
  submitting = false,
}: SubscriptionRequestModalProps) {
  const [reason, setReason] = useState('');
  const [requestedDays, setRequestedDays] = useState<number | undefined>(undefined);

  if (!open || !emp) return null;

  const handleSubmit = () => {
    if (!reason.trim()) return;
    onSubmit({ reason: reason.trim(), requestedDays });
  };

  const handleClose = () => {
    setReason('');
    setRequestedDays(undefined);
    onClose();
  };

  return (
    <>
      {/* backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="申请使用"
        className={cn(
          'fixed left-1/2 top-1/2 z-[70] w-full max-w-[480px] -translate-x-1/2 -translate-y-1/2',
          'rounded-glass-2xl border border-glassline bg-glass-1 shadow-glass-xl backdrop-blur-glass-xl',
          'p-6',
        )}
      >
        {/* header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gtext-primary">申请使用</h2>
          <button
            onClick={handleClose}
            className="rounded-glass-md p-1.5 text-gtext-muted transition-colors hover:bg-glass-2 hover:text-gtext-primary"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* employee info */}
        <div className="mb-4 rounded-glass-lg border border-glassline bg-glass-2 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gbrand/20 text-lg font-bold text-gbrand-text">
              {emp.name.slice(0, 2)}
            </div>
            <div>
              <p className="font-medium text-gtext-primary">{emp.name}</p>
              <p className="text-[13px] text-gtext-secondary">
                {emp.position}
                {emp.industry ? ` · ${emp.industry}` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* form */}
        <div className="space-y-4">
          {/* reason */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-gtext-primary">
              使用场景说明 <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请说明您需要使用该员工的场景和用途..."
              className={cn(
                'w-full rounded-glass-lg border border-glassline bg-glass-2 px-3 py-2.5 text-[14px]',
                'placeholder:text-gtext-muted focus:border-gbrand focus:outline-none',
                'min-h-[100px] resize-y',
              )}
              disabled={submitting}
            />
            <p className="mt-1 text-[12px] text-gtext-muted">必填，帮助管理员了解您的需求</p>
          </div>

          {/* duration */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-gtext-primary">
              期望使用时长
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setRequestedDays(opt.value)}
                  disabled={submitting}
                  className={cn(
                    'rounded-glass-md border px-3 py-1.5 text-[13px] transition-all',
                    requestedDays === opt.value
                      ? 'border-gbrand bg-gbrand/10 text-gbrand-text'
                      : 'border-glassline bg-glass-2 text-gtext-secondary hover:bg-glass-3',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-gtext-muted">
              不选择则默认长期有效
            </p>
          </div>
        </div>

        {/* footer */}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="glass" size="sm" onClick={handleClose} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="glass-primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!reason.trim() || submitting}
          >
            {submitting ? '提交中...' : '提交申请'}
          </Button>
        </div>

        <p className="mt-3 text-center text-[12px] text-gtext-muted">
          提交后将通知企业管理员审批，审批通过后即可使用
        </p>
      </div>
    </>
  );
}
