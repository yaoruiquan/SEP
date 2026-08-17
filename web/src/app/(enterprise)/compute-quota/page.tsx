'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuotaSummary } from '@/lib/api/use-quota';
import { Loader2, User, Bot, Building2, TrendingUp } from 'lucide-react';
import { UserQuotaTab } from './user-quota-tab';
import { SubscriptionQuotaTab } from './subscription-quota-tab';
import { EnterpriseQuotaTab } from './enterprise-quota-tab';

function formatNumber(num: number) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

function pct(used: number, total: number) {
  if (total === 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

// p = used %, bar shows REMAINING: green when plenty left, red when almost gone
function progressColor(p: number) {
  const rem = 100 - p;
  if (rem <= 20) return 'bg-red-500';
  if (rem <= 40) return 'bg-yellow-400';
  return 'bg-emerald-500';
}

function progressBg(p: number) {
  const rem = 100 - p;
  if (rem <= 20) return 'bg-red-100';
  if (rem <= 40) return 'bg-yellow-100';
  return 'bg-emerald-100';
}

interface SummaryCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  priority: string;
  accent: string;
  used: number;
  total: number;
}

function SummaryCard({ icon, title, subtitle, priority, accent, used, total }: SummaryCardProps) {
  const p = pct(used, total);
  const remaining = total - used;
  const bar = progressColor(p);
  const bg = progressBg(p);

  return (
    <div className={`relative overflow-hidden rounded-xl border bg-white p-5 shadow-sm`}>
      {/* accent stripe */}
      <div className={`absolute left-0 top-0 h-full w-1 ${accent}`} />

      <div className="flex items-start justify-between pl-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
            {icon}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">{priority}</p>
            <p className="font-semibold">{title}</p>
          </div>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {subtitle}
        </span>
      </div>

      <div className="mt-4 pl-3">
        <div className="flex items-end justify-between">
          <div>
            <span className="text-3xl font-bold tracking-tight">{formatNumber(remaining)}</span>
            <span className="ml-1 text-sm text-muted-foreground">剩余</span>
          </div>
          <div className="text-right text-sm">
            <span className={`font-semibold ${p >= 80 ? 'text-red-500' : p >= 60 ? 'text-yellow-500' : 'text-emerald-600'}`}>
              {100 - p}%
            </span>
            <span className="text-muted-foreground"> 剩余</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-2.5 rounded-full transition-all duration-500 ${bar}`}
            style={{ width: `${100 - p}%` }}
          />
        </div>

        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
          <span>已用 {formatNumber(used)}</span>
          <span>总额 {formatNumber(total)}</span>
        </div>
      </div>
    </div>
  );
}

export default function ComputeQuotaPage() {
  const [activeTab, setActiveTab] = useState('user');
  const { data: summary, isLoading } = useQuotaSummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">算力配额管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          三级消耗优先级：个人配额（Priority 0）→ 订阅配额（Priority 1）→ 企业池（Priority 2）
        </p>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            icon={<User className="h-5 w-5 text-blue-600" />}
            title="个人配额"
            subtitle="优先消耗"
            priority="Priority 0 · 碳基员工"
            accent="bg-blue-500"
            used={summary.user.usedTokens}
            total={summary.user.totalTokens}
          />
          <SummaryCard
            icon={<Bot className="h-5 w-5 text-emerald-600" />}
            title="订阅配额"
            subtitle="硅基员工自带"
            priority="Priority 1 · 订阅绑定"
            accent="bg-emerald-500"
            used={summary.subscription.usedTokens}
            total={summary.subscription.totalTokens}
          />
          <SummaryCard
            icon={<Building2 className="h-5 w-5 text-purple-600" />}
            title="企业池"
            subtitle="兜底"
            priority="Priority 2 · 企业统一池"
            accent="bg-purple-500"
            used={summary.enterprise.usedTokens}
            total={summary.enterprise.totalTokens}
          />
        </div>
      ) : null}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="user" className="gap-2">
            <User className="h-3.5 w-3.5" /> 个人配额
          </TabsTrigger>
          <TabsTrigger value="subscription" className="gap-2">
            <Bot className="h-3.5 w-3.5" /> 员工配额
          </TabsTrigger>
          <TabsTrigger value="enterprise" className="gap-2">
            <Building2 className="h-3.5 w-3.5" /> 企业池
          </TabsTrigger>
        </TabsList>

        <TabsContent value="user" className="mt-4">
          <UserQuotaTab />
        </TabsContent>
        <TabsContent value="subscription" className="mt-4">
          <SubscriptionQuotaTab />
        </TabsContent>
        <TabsContent value="enterprise" className="mt-4">
          <EnterpriseQuotaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
