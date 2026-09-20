'use client';

import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const PieChart = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.PieChart }))
);
const Pie = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.Pie }))
);
const Cell = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.Cell }))
);
const Legend = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.Legend }))
);
const Tooltip = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.Tooltip }))
);
const ResponsiveContainer = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.ResponsiveContainer }))
);

interface LazyPieChartProps {
  data: any[];
  dataKey: string;
  nameKey: string;
  height?: number;
  colors?: string[];
  className?: string;
}

function ChartFallback({ height = 300 }: { height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <Skeleton className="h-full w-full rounded-lg" />
    </div>
  );
}

export function LazyPieChart({
  data,
  dataKey,
  nameKey,
  height = 300,
  colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
  className,
}: LazyPieChartProps) {
  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ResponsiveContainer width="100%" height={height} className={className}>
        <PieChart>
          <Pie
            data={data}
            dataKey={dataKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            outerRadius={80}
            label
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </Suspense>
  );
}
