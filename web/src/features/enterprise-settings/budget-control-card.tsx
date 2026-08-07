'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { AlertCircle } from 'lucide-react';

interface BudgetControlCardProps {
  /** null = 不限预算 */
  monthlyBudget: number | null;
  alertThreshold: number;
  hardStopOnBudget: boolean;
  onBudgetChange: (value: number | null) => void;
  onThresholdChange: (value: number) => void;
  onHardStopChange: (value: boolean) => void;
  disabled?: boolean;
}

/**
 * 预算控制卡片：月度预算 + 告警阈值 + 超额硬性阻断。
 *
 * 阈值和阻断开关只在设了预算后才有意义，所以未设预算时整块隐藏，
 * 避免出现「阈值 80% 但没有上限」这种读不通的状态。
 */
export function BudgetControlCard({
  monthlyBudget,
  alertThreshold,
  hardStopOnBudget,
  onBudgetChange,
  onThresholdChange,
  onHardStopChange,
  disabled = false,
}: BudgetControlCardProps) {
  // 注意用 !== null 而不是真值判断：预算填 0 也是有效的（等于禁止消费）
  const hasBudget = monthlyBudget !== null;

  return (
    <div className="space-y-6 rounded-lg border border-border bg-card p-6">
      <div>
        <h3 className="text-lg font-semibold">预算控制</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          设置月度算力预算上限，消费达到阈值时告警
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="monthly-budget">月度预算（元）</Label>
        <Input
          id="monthly-budget"
          type="number"
          min="0"
          step="100"
          placeholder="留空 = 不限预算"
          disabled={disabled}
          value={monthlyBudget ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onBudgetChange(null);
              return;
            }
            const parsed = Number(raw);
            // 输入中间态（如 "-"、"1e"）会得到 NaN，忽略而不是写入脏值
            if (Number.isFinite(parsed) && parsed >= 0) {
              onBudgetChange(parsed);
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          留空表示不限制月度预算。按自然月统计，每月 1 日归零。
        </p>
      </div>

      {hasBudget && (
        <div className="space-y-3 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <Label>告警阈值</Label>
            <span className="text-sm font-medium text-primary">
              {Math.round(alertThreshold * 100)}%
              <span className="ml-2 font-normal text-muted-foreground">
                ≈ ¥{(monthlyBudget * alertThreshold).toFixed(2)}
              </span>
            </span>
          </div>
          <Slider
            value={[alertThreshold]}
            min={0.5}
            max={1}
            step={0.05}
            disabled={disabled}
            onValueChange={(v) => onThresholdChange(v[0])}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            消费达到该比例时向企业管理员发送告警通知
          </p>
        </div>
      )}

      {hasBudget && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <Label htmlFor="hard-stop" className="cursor-pointer font-medium">
                超预算硬性阻断
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              开启后，当月消费达到预算上限将禁止发起新会话（返回 403）。
              关闭则仅告警，不影响使用。
            </p>
          </div>
          <Switch
            id="hard-stop"
            checked={hardStopOnBudget}
            disabled={disabled}
            onCheckedChange={onHardStopChange}
          />
        </div>
      )}
    </div>
  );
}
