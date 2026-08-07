'use client';

import { useState } from 'react';
import { Download, AlertTriangle, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/lib/auth-store';
import { downloadFile } from '@/lib/api-client';
import { format, startOfMonth, endOfDay } from 'date-fns';
import {
  useCostSummary,
  useCostByDepartment,
  useCostByEmployee,
  useCostByModel,
  useCostTrend,
  useCostAlerts,
  type Granularity,
} from '@/features/cost-analytics/use-cost-analytics';
import { CostSummaryCards } from '@/features/cost-analytics/cost-summary-cards';
import { CostTrendChart } from '@/features/cost-analytics/cost-trend-chart';
import { CostByDimensionChart } from '@/features/cost-analytics/cost-by-dimension-chart';

function AlertBanner({ alerts }: { alerts: Array<{ type: string; severity: string; message: string }> }) {
  if (alerts.length === 0) return null;

  const critical = alerts.filter((a) => a.severity === 'ERROR');
  const warnings = alerts.filter((a) => a.severity === 'WARNING');

  return (
    <div className="space-y-2">
      {critical.map((a, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700">{a.message}</p>
            <p className="text-xs text-red-600 mt-0.5">建议立即调整预算或暂停非必要调用</p>
          </div>
        </div>
      ))}
      {warnings.map((a, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-700">{a.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CostAnalyticsPage() {
  const enterprise = useAuthStore((s) => s.enterprise);
  const enterpriseId = enterprise?.id ?? '';

  // 日期范围：默认本月
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfDay(new Date()), 'yyyy-MM-dd'));
  const [granularity, setGranularity] = useState<Granularity>('day');

  const params = { from: startDate, to: endDate };

  // 数据 hooks
  const { data: summary, isLoading: summaryLoading } = useCostSummary(enterpriseId, params);
  const { data: deptData = [], isLoading: deptLoading } = useCostByDepartment(enterpriseId, params);
  const { data: empData = [], isLoading: empLoading } = useCostByEmployee(enterpriseId, params);
  const { data: modelData = [], isLoading: modelLoading } = useCostByModel(enterpriseId, params);
  const { data: trendData = [], isLoading: trendLoading } = useCostTrend(enterpriseId, granularity, params);
  const { data: alerts = [] } = useCostAlerts(enterpriseId);

  const handleExport = async () => {
    try {
      await downloadFile(
        `/enterprises/${enterpriseId}/cost/export?from=${startDate}&to=${endDate}&format=csv`,
      );
      toast.success('导出成功');
    } catch {
      toast.error('导出失败，请重试');
    }
  };

  if (!enterprise) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <p className="text-neutral-400">无企业信息</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页头 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">成本归因分析</h1>
          <p className="mt-1 text-sm text-neutral-600">企业算力成本明细与预算监控</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 日期范围 */}
          <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-2 py-1">
            <Calendar className="h-4 w-4 text-neutral-400" />
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-7 w-32 border-0 p-0 text-sm focus-visible:ring-0"
            />
            <span className="text-neutral-400 text-sm">—</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-7 w-32 border-0 p-0 text-sm focus-visible:ring-0"
            />
          </div>

          {/* 导出 */}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1" />
            导出 CSV
          </Button>
        </div>
      </div>

      {/* 告警横幅 */}
      <AlertBanner alerts={alerts} />

      {/* 概览卡片 */}
      {summaryLoading ? (
        <div className="text-center py-8 text-neutral-400">加载概览中…</div>
      ) : summary ? (
        <CostSummaryCards summary={summary} />
      ) : null}

      {/* 成本趋势 */}
      <CostTrendChart
        data={trendData}
        granularity={granularity}
        onGranularityChange={setGranularity}
        isLoading={trendLoading}
      />

      {/* 成本归因（三维度） */}
      <CostByDimensionChart
        departmentData={deptData}
        employeeData={empData}
        modelData={modelData}
        isLoading={deptLoading || empLoading || modelLoading}
      />
    </div>
  );
}
