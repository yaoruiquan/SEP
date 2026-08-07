'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CostByDimensionItem } from '@/lib/types';

const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
];

type Dimension = 'department' | 'employee' | 'model';

const DIM_LABELS: Record<Dimension, string> = {
  department: '按部门',
  employee: '按员工',
  model: '按模型',
};

interface Props {
  departmentData: CostByDimensionItem[];
  employeeData: CostByDimensionItem[];
  modelData: CostByDimensionItem[];
  isLoading?: boolean;
}

function RankList({ items }: { items: CostByDimensionItem[] }) {
  const sorted = [...items].sort((a, b) => b.cost - a.cost).slice(0, 8);
  return (
    <div className="space-y-2 mt-1">
      {sorted.map((item, i) => (
        <div key={item.id} className="flex items-center gap-3">
          <span className="w-5 text-xs text-neutral-400 font-mono text-right shrink-0">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center mb-0.5">
              <span className="text-xs font-medium text-neutral-700 truncate max-w-[140px]">
                {item.name}
              </span>
              <span className="text-xs text-neutral-500 shrink-0 ml-2">
                ¥{item.cost.toFixed(4)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${item.percent}%`,
                  backgroundColor: PALETTE[i % PALETTE.length],
                }}
              />
            </div>
          </div>
          <span className="text-xs text-neutral-400 w-10 text-right shrink-0">
            {item.percent.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function DimChart({ items }: { items: CostByDimensionItem[] }) {
  const data = [...items].sort((a, b) => b.cost - a.cost).slice(0, 8);
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-neutral-400 text-sm">
        暂无数据
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
        <XAxis
          type="number"
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `¥${Number(v ?? 0).toFixed(2)}`}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11 }}
          width={80}
          tickFormatter={(v: string) => (v.length > 8 ? `${v.slice(0, 7)}…` : v)}
        />
        <Tooltip
          formatter={(v) => [`¥${Number(v ?? 0).toFixed(4)}`, '花费']}
        />
        <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CostByDimensionChart({
  departmentData,
  employeeData,
  modelData,
  isLoading,
}: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {(['department', 'employee', 'model'] as Dimension[]).map((dim) => {
        const items =
          dim === 'department'
            ? departmentData
            : dim === 'employee'
            ? employeeData
            : modelData;
        return (
          <Card key={dim}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                成本归因 · {DIM_LABELS[dim]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 flex items-center justify-center text-neutral-400 text-sm">
                  加载中…
                </div>
              ) : (
                <>
                  <DimChart items={items} />
                  <RankList items={items} />
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
