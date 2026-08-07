'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { CostTrendPoint } from '@/lib/types';
import type { Granularity } from './use-cost-analytics';

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: '按天',
  week: '按周',
  month: '按月',
};

interface Props {
  data: CostTrendPoint[];
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
  isLoading?: boolean;
}

function formatXTick(value: string, granularity: Granularity) {
  if (granularity === 'day') {
    try {
      return format(new Date(value), 'MM/dd');
    } catch {
      return value;
    }
  }
  return value; // week/month labels come pre-formatted from the API
}

export function CostTrendChart({ data, granularity, onGranularityChange, isLoading }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">成本趋势</CardTitle>
          <div className="flex rounded-md border border-neutral-200 divide-x divide-neutral-200 text-xs overflow-hidden">
            {(['day', 'week', 'month'] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => onGranularityChange(g)}
                className={cn(
                  'px-2.5 py-1 transition-colors',
                  granularity === g
                    ? 'bg-primary text-white'
                    : 'bg-white text-neutral-600 hover:bg-neutral-50',
                )}
              >
                {GRANULARITY_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-56 flex items-center justify-center text-neutral-400 text-sm">
            加载中…
          </div>
        ) : data.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-neutral-400 text-sm">
            暂无数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => formatXTick(v, granularity)}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `¥${Number(v ?? 0).toFixed(0)}`}
              />
              <Tooltip
                formatter={(v) => [`¥${Number(v ?? 0).toFixed(4)}`, '花费']}
                labelFormatter={(l) => {
                  if (granularity === 'day') {
                    try {
                      return format(new Date(String(l)), 'yyyy-MM-dd', { locale: zhCN });
                    } catch {
                      return String(l);
                    }
                  }
                  return String(l);
                }}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#3b82f6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#costGrad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
