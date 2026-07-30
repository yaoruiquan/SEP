'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Users, Check, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { cn, CAPABILITY_TYPE_META } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { useMarketEmployees } from '@/features/employee/use-employees';
import { useSubscriptions, useSubscribe } from '@/features/subscription/use-subscriptions';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';

const INDUSTRIES = ['全部', '电商零售', '金融服务', '医疗健康', '教育培训', '制造业', '物流运输', '餐饮服务', '企业服务'];

export default function MarketplacePage() {
  const { token, hydrated } = useAuthStore();
  const loggedIn = hydrated && Boolean(token);

  // 搜索走服务端（后端支持 ?search=），300ms 防抖
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data: employees = [], isLoading } = useMarketEmployees(search);

  // 订阅列表需登录 —— 访客不请求，否则每次都白跑一轮 401 + refresh
  const { data: subs = [] } = useSubscriptions({ enabled: loggedIn });
  const subscribe = useSubscribe();
  const subscribedIds = new Set(subs.map((s) => s.employee.id));

  const filtered = search
    ? employees
    : industry
    ? employees.filter((e) => e.industry?.includes(industry))
    : employees;

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#eb3f00] to-orange-400 px-8 py-10 text-white">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 right-20 h-24 w-24 rounded-full bg-white/8" />
        <div className="relative">
          <p className="mb-2 text-sm font-medium text-orange-100">🌟 硅基员工人才市场</p>
          <h1 className="mb-3 text-3xl font-bold">发现适合你企业的数字员工</h1>
          <p className="text-base text-orange-100">涵盖电商、金融、医疗、教育等 8 大行业，120+ 经过审核的硅基员工等你招聘</p>
        </div>
      </div>

      {/* 新员工播报 */}
      <div className="overflow-hidden rounded-lg border border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            🎉 最新动态
          </span>
          <div className="flex-1 overflow-hidden">
            <p className="animate-marquee whitespace-nowrap text-sm text-fg-muted">
              本周新入职：<span className="font-medium text-foreground">数据分析师·小智</span>、
              <span className="font-medium text-foreground">客服助手·小美</span>、
              <span className="font-medium text-foreground">营销文案·小文</span>
              已为 50+ 企业提供服务 🚀
            </p>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="搜索员工名称、行业、岗位…"
          className="pl-9"
        />
      </div>

      {/* 行业分类 Chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {INDUSTRIES.map((ind) => (
          <button
            key={ind}
            onClick={() => setIndustry(ind === '全部' ? '' : ind)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition-all ${
              (ind === '全部' && !industry) || industry === ind
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-card text-fg-muted hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {ind}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={search ? '没有找到匹配的员工' : '暂无已上架的员工'}
          description={search ? '试试其他关键词' : '请稍后再来'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((emp) => {
            const subscribed = subscribedIds.has(emp.id);
            const capTypes = Array.from(
              new Set(emp.bindings?.map((b) => b.capability.type) ?? []),
            );
            const primaryType = capTypes[0] || 'SKILL';

            // Header gradient mapping
            const headerGradients: Record<string, string> = {
              AGENT: 'from-indigo-100 via-violet-50 to-purple-100',
              RPA: 'from-emerald-100 via-teal-50 to-cyan-100',
              SKILL: 'from-orange-100 via-amber-50 to-yellow-100',
              AI_APP: 'from-amber-100 via-yellow-50 to-orange-100',
            };

            const typeEmojis: Record<string, string> = {
              AGENT: '🤖',
              RPA: '🔄',
              SKILL: '⚡',
              AI_APP: '✨',
            };

            const headerGradient = headerGradients[primaryType] || headerGradients.SKILL;
            const typeEmoji = typeEmojis[primaryType] || '🤖';

            return (
              <Card
                key={emp.id}
                className="group relative flex flex-col overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-xl"
              >
                {/* 顶部类型色带 */}
                <div className={`h-1 w-full bg-gradient-to-r ${
                  primaryType === 'AGENT'  ? 'from-indigo-500 to-violet-400' :
                  primaryType === 'RPA'    ? 'from-emerald-600 to-teal-400' :
                  primaryType === 'AI_APP' ? 'from-amber-500 to-yellow-400' :
                                             'from-primary to-orange-400'
                }`} />

                {/* 渐变头像区 */}
                <div className={`relative h-32 bg-gradient-to-br ${headerGradient}`}>
                  {/* 头像容器 - 居中在这个区域底部，部分溢出到下方 */}
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white ring-4 ring-white shadow-xl">
                      <span className="text-5xl">{typeEmoji}</span>
                    </div>
                    {/* 右上角在线状态点 */}
                    <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm">
                      <PulsingDot />
                    </div>
                  </div>
                  {/* 右上角已入职 badge */}
                  {subscribed && (
                    <div className="absolute right-3 top-3">
                      <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-success backdrop-blur-sm">
                        ✓ 已入职
                      </span>
                    </div>
                  )}
                </div>

                <CardContent className="flex flex-1 flex-col gap-3 p-5 pt-12">
                  {/* 名称居中 */}
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-foreground">{emp.name}</h3>
                    <p className="mt-1 text-sm text-fg-muted">{emp.position} · {emp.industry}</p>
                  </div>

                  {/* 分隔线 */}
                  <div className="mx-auto w-16 border-t border-border" />

                  {/* 描述（2行截断）*/}
                  <p className="line-clamp-2 text-center text-sm text-fg-subtle">{emp.description}</p>

                  {/* 擅长领域 badges */}
                  <div>
                    <p className="mb-2 text-center text-xs font-medium text-fg-muted">💡 擅长领域</p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {capTypes.map((type, i) => {
                        const meta = CAPABILITY_TYPE_META[type];
                        if (!meta) return null;
                        return (
                          <Badge key={i} className={`${meta.tone} text-xs`}>
                            {meta.label}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  {/* 近期帮助 */}
                  <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-center">
                    <p className="text-xs text-fg-subtle">
                      🔥 已服务 <span className="font-semibold text-foreground">{Math.floor(Math.random() * 20) + 5}</span> 家企业
                    </p>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center justify-center gap-4 border-t border-border pt-3 text-xs text-fg-subtle">
                    <span className="flex items-center gap-1">
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      {emp.bindings?.length ?? 0} 项技能
                    </span>
                    <span className="flex items-center gap-1.5">
                      <PulsingDot className="h-1.5 w-1.5" />
                      <span className="text-success">运行中</span>
                    </span>
                    <span className="text-fg-muted">v{emp.version ?? '1.0.0'}</span>
                  </div>

                  {/* Actions (居中) */}
                  <div className="flex flex-col items-center gap-2 pt-2">
                    {subscribed ? (
                      <Link href="/my-employees" className="w-full">
                        <Button variant="secondary" size="sm" className="w-full">
                          管理此员工
                        </Button>
                      </Link>
                    ) : loggedIn ? (
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={subscribe.isPending}
                        onClick={() =>
                          subscribe.mutate(emp.id, {
                            onSuccess: () => toast.success(`已订阅「${emp.name}」`),
                            onError: (e) =>
                              toast.error(
                                e instanceof ApiError ? e.message : '订阅失败',
                              ),
                          })
                        }
                      >
                        ⚡ 立即招聘
                      </Button>
                    ) : (
                      <Link
                        href={`/login?redirect=${encodeURIComponent(`/marketplace/${emp.id}`)}`}
                        className="w-full"
                      >
                        <Button variant="secondary" size="sm" className="w-full">
                          预约试用
                        </Button>
                      </Link>
                    )}
                    <Link
                      href={`/marketplace/${emp.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      查看详情 →
                    </Link>
                  </div>

                  {/* Free trial hint */}
                  {!subscribed && (
                    <p className="text-center text-xs text-fg-subtle">
                      免费试用 7 天 · 随时解约
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
