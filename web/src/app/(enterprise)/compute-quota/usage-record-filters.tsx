'use client';

import { useMemo } from 'react';
import { Download, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSubscriptionCredits } from '@/lib/api/use-compute-credit';
import { useMembers } from '@/features/enterprise/use-enterprise';

/** Radix Select 不接受空字符串作为 value，用 ALL 当「不筛」的哨兵值。 */
const ALL = 'all';

export interface UsageFilterState {
  employeeId?: string;
  memberId?: string;
  startDate?: string;
  endDate?: string;
}

interface Props {
  value: UsageFilterState;
  onChange: (next: UsageFilterState) => void;
  onExport: () => void;
  exporting: boolean;
  /** 当前筛选命中的条数，让「导出」前就知道会导出多少 */
  total: number;
}

/**
 * 算力消费明细的筛选栏：硅基员工 / 使用成员 / 日期区间。
 *
 * 员工选项直接复用本页已经拉过的赠送额度列表（同一个 queryKey，不额外打请求）；
 * 成员选项来自企业成员表。两者都只是筛选用的候选集，为空时按钮禁用而不是给个空下拉。
 */
export function UsageRecordFilters({
  value,
  onChange,
  onExport,
  exporting,
  total,
}: Props) {
  const { data: credits } = useSubscriptionCredits();
  const { data: members } = useMembers();

  const employeeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of credits ?? []) {
      if (!seen.has(c.employeeId)) seen.set(c.employeeId, c.employeeName);
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [credits]);

  const memberOptions = useMemo(
    () =>
      (members ?? []).map((m) => ({
        id: m.user.id,
        name: m.user.name ?? m.user.email,
      })),
    [members],
  );

  const dirty =
    !!value.employeeId || !!value.memberId || !!value.startDate || !!value.endDate;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3">
      <Select
        value={value.employeeId ?? ALL}
        onValueChange={(v) =>
          onChange({ ...value, employeeId: v === ALL ? undefined : v })
        }
        disabled={employeeOptions.length === 0}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="全部硅基员工" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部硅基员工</SelectItem>
          {employeeOptions.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.memberId ?? ALL}
        onValueChange={(v) =>
          onChange({ ...value, memberId: v === ALL ? undefined : v })
        }
        disabled={memberOptions.length === 0}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="全部使用成员" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部使用成员</SelectItem>
          {memberOptions.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="起始日期"
          value={value.startDate ?? ''}
          max={value.endDate || undefined}
          onChange={(e) =>
            onChange({ ...value, startDate: e.target.value || undefined })
          }
          className="h-8 w-32 text-xs"
        />
        <span className="text-fg-muted">—</span>
        <Input
          type="date"
          aria-label="结束日期"
          value={value.endDate ?? ''}
          min={value.startDate || undefined}
          onChange={(e) => onChange({ ...value, endDate: e.target.value || undefined })}
          className="h-8 w-32 text-xs"
        />
      </div>

      <div className="flex-1" />

      <span className="text-xs tabular-nums text-fg-muted">
        命中 {total.toLocaleString('zh-CN')} 条
      </span>

      {dirty && (
        <Button
          size="sm"
          variant="glass"
          onClick={() => onChange({})}
          className="h-8 text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重置
        </Button>
      )}

      <Button
        size="sm"
        variant="glass"
        onClick={onExport}
        disabled={exporting || total === 0}
        className="h-8 text-xs"
      >
        {exporting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        导出 CSV
      </Button>
    </div>
  );
}
