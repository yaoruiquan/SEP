'use client';

import { lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

const AreaChart = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.AreaChart }))
);
const Area = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.Area }))
);
const XAxis = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.XAxis }))
);
const YAxis = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.YAxis }))
);
const CartesianGrid = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.CartesianGrid }))
);
const Tooltip = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.Tooltip }))
);
const ResponsiveContainer = lazy(() =>
  import('recharts').then((mod) => ({ default: mod.ResponsiveContainer }))
);

interface LazyAreaChartProps {
  data: any[];
  dataKey: string;
  xAxisKey: string;
  height?: number;
  className?: string;
  color?: string;
}

function ChartFallback({ height = 300 }: { height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <Skeleton className="h-full w-full rounded-lg" />
    </div>
  );
}

export function LazyAreaChart({
  data,
  dataKey,
  xAxisKey,
  height = 300,
  className,
  color = '#8b5cf6',
}: LazyAreaChartProps) {
  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ResponsiveContainer width="100%" height={height} className={className}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey={xAxisKey}
            tick={{ fontSize: 12 }}
            stroke="#9ca3af"
          />
          <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
          <Tooltip />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            fill={color}
            fillOpacity={0.2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Suspense>
  );
}
