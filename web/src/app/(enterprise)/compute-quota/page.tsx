'use client';

import Link from 'next/link';
import { ArrowRight, BadgeCheck, Bot, Building2, CreditCard, Loader2, ShieldCheck, Sparkles, UserRound, Wallet, Zap } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useQuotaPackages, useQuotaSummary, usePurchaseQuotaPackage } from '@/lib/api/use-quota';
import { useWalletBalance } from '@/lib/api/wallet';
import { cn } from '@/lib/utils';
import { EnterpriseQuotaTab } from './enterprise-quota-tab';
import { SubscriptionQuotaTab } from './subscription-quota-tab';
import { UserQuotaTab } from './user-quota-tab';

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toLocaleString('zh-CN');
}
function formatCny(value: number) { return `¥${value.toFixed(2)}`; }

function AllocationStat({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <div className="border-l border-border/70 px-5 first:border-l-0 first:pl-0 max-md:border-l-0 max-md:border-t max-md:px-0 max-md:pt-4 max-md:first:border-t-0 max-md:first:pt-0"><div className="flex items-center gap-2 text-xs font-medium text-fg-muted"><span className={cn('flex h-7 w-7 items-center justify-center rounded-md', tone)}>{icon}</span>{label}</div><p className="mt-3 text-2xl font-semibold tabular-nums text-foreground">{value}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{detail}</p></div>;
}

export default function ComputeQuotaPage() {
  const { toast } = useToast();
  const { data: summary, isLoading: summaryLoading } = useQuotaSummary();
  const { data: wallet } = useWalletBalance();
  const { data: packages, isLoading: packagesLoading } = useQuotaPackages();
  const purchase = usePurchaseQuotaPackage();
  const handlePurchase = async (packageId: string, name: string) => { try { await purchase.mutateAsync(packageId); toast({ title: '算力包已到账', description: `「${name}」已进入企业可分配池，请按成员需要分配额度。` }); } catch (error: any) { toast({ title: '购买失败', description: error?.message || '请检查钱包余额后重试', variant: 'destructive' }); } };

  return <div className="space-y-8 pb-10">
    <section className="border-b border-border/70 pb-7"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><div className="inline-flex items-center gap-2 text-xs font-medium text-primary"><Zap className="h-3.5 w-3.5" />企业算力中心</div><h1 className="mt-3 text-2xl font-semibold text-foreground">算力管理</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">硅基员工对话先使用其订阅赠送额度；赠送额度不足时，才使用管理员为该碳基员工分配的额度。</p></div><div className="flex items-center gap-3"><div className="min-w-32 border border-border/70 bg-background/50 px-4 py-2.5"><p className="text-[11px] text-fg-muted">企业钱包余额</p><p className="mt-1 text-base font-semibold tabular-nums text-foreground">{wallet ? formatCny(Number(wallet.balance)) : '—'}</p></div><Link href="/payment/recharge" className={cn(buttonVariants({ variant: 'glass-primary', size: 'md' }))}><Wallet className="h-4 w-4" />充值钱包<ArrowRight className="h-4 w-4" /></Link></div></div></section>
    {summaryLoading ? <div className="flex justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" /></div> : summary ? <section className="border border-border/70 bg-card p-5 md:p-6"><div className="flex flex-col gap-2 border-b border-border/70 pb-5 md:flex-row md:items-center md:justify-between"><div><h2 className="text-base font-semibold text-foreground">企业可分配池</h2><p className="mt-1 text-sm text-fg-muted">购买额度先进入这里，由管理员分配给碳基员工，不会在对话中自动扣减。</p></div><a href="#member-quotas" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">分配给碳基员工<ArrowRight className="h-4 w-4" /></a></div><div className="mt-5 grid gap-5 md:grid-cols-3"><AllocationStat icon={<Building2 className="h-4 w-4 text-violet-600" />} label="当前可分配" value={formatTokens(summary.enterprise.availableTokens)} detail="尚未分配给成员的企业额度" tone="bg-violet-100" /><AllocationStat icon={<UserRound className="h-4 w-4 text-sky-600" />} label="已分配给成员" value={formatTokens(summary.enterprise.allocatedTokens)} detail={`${formatTokens(summary.user.usedTokens)} 已由成员使用`} tone="bg-sky-100" /><AllocationStat icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />} label="已购入总额度" value={formatTokens(summary.enterprise.totalTokens)} detail="含历史已消耗的企业池额度" tone="bg-emerald-100" /></div></section> : null}
    <section id="subscription-quotas" className="scroll-mt-8"><div className="mb-4"><div className="flex items-center gap-2 text-base font-semibold text-foreground"><Bot className="h-4 w-4 text-emerald-600" />硅基员工订阅赠送额度</div><p className="mt-1 text-sm text-fg-muted">每笔额度只属于对应的硅基员工；与该员工对话时优先消耗。</p></div><SubscriptionQuotaTab /></section>
    <section id="member-quotas" className="scroll-mt-8"><div className="mb-4"><div className="flex items-center gap-2 text-base font-semibold text-foreground"><UserRound className="h-4 w-4 text-sky-600" />碳基员工已分配额度</div><p className="mt-1 text-sm text-fg-muted">成员只会在当前硅基员工的订阅赠送额度不足后使用这部分额度。</p></div><UserQuotaTab /></section>
    <section><div className="mb-4"><div className="flex items-center gap-2 text-base font-semibold text-foreground"><Building2 className="h-4 w-4 text-violet-600" />企业可分配池明细</div><p className="mt-1 text-sm text-fg-muted">查看企业购买的额度来源与状态。</p></div><EnterpriseQuotaTab /></section>
    <section className="border-t border-border/70 pt-8"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><h2 className="text-lg font-semibold text-foreground">购买企业算力包</h2><p className="mt-1 text-sm text-fg-muted">购买后进入企业可分配池，管理员可在上方按成员需要配置额度。</p></div><div className="flex items-center gap-2 text-xs text-fg-muted"><ShieldCheck className="h-4 w-4 text-emerald-500" />钱包扣款与额度入账同一笔交易完成</div></div>{packagesLoading ? <div className="mt-5 grid gap-4 md:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-56 animate-pulse bg-muted" />)}</div> : <div className="mt-5 grid gap-4 md:grid-cols-3">{packages?.map((item) => <Card key={item.id} variant="solid" className={cn('relative overflow-hidden transition-shadow hover:shadow-md', item.recommended && 'border-primary/50')}>{item.recommended && <div className="absolute right-4 top-4 inline-flex items-center gap-1 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary"><BadgeCheck className="h-3.5 w-3.5" />推荐</div>}<CardHeader><div className="mb-3 flex h-9 w-9 items-center justify-center bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></div><CardTitle>{item.name}</CardTitle><CardDescription>{item.detail}</CardDescription></CardHeader><CardContent><div className="flex items-baseline gap-2"><span className="text-3xl font-semibold tabular-nums text-foreground">{formatCny(item.priceCny)}</span><span className="text-xs text-fg-muted">一次性</span></div><div className="mt-4 flex items-center justify-between border-y border-border/70 py-3 text-sm"><span className="font-medium">{formatTokens(item.tokens)} tokens</span><span className="text-xs text-fg-muted">{formatCny(item.unitPriceCnyPerMillion)} / 1M</span></div><Button className="mt-4 w-full" variant={item.recommended ? 'glass-primary' : 'glass'} onClick={() => handlePurchase(item.id, item.name)} disabled={purchase.isPending}><CreditCard className="h-4 w-4" />{purchase.isPending ? '处理中…' : '购买并加入可分配池'}</Button></CardContent></Card>)}</div>}</section>
  </div>;
}
