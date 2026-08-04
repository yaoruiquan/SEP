'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Wrench, Check, Package, PlayCircle, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { cn, CAPABILITY_TYPE_META } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { useMarketEmployee } from '@/features/employee/use-employees';
import { useSubscriptions, useSubscribe } from '@/features/subscription/use-subscriptions';
import { toast } from '@/components/ui/toast';
import { PaymentModal } from '@/components/ui/payment-modal';
import { ApiError } from '@/lib/api-client';

// ─── avatar gradient（与卡片/抽屉同一套映射）──────────────────────────────────

const GRAD_MAP: [string, string][] = [
  ['人事', 'linear-gradient(135deg,#7c3aed,#a855f7)'],
  ['HR',   'linear-gradient(135deg,#7c3aed,#a855f7)'],
  ['销售', 'linear-gradient(135deg,#2563eb,#3b82f6)'],
  ['CRM',  'linear-gradient(135deg,#2563eb,#3b82f6)'],
  ['财务', 'linear-gradient(135deg,#0891b2,#06b6d4)'],
  ['运营', 'linear-gradient(135deg,#059669,#10b981)'],
  ['营销', 'linear-gradient(135deg,#db2777,#f43f5e)'],
  ['技术', 'linear-gradient(135deg,#d97706,#f59e0b)'],
];

function avatarGradient(position: string, industry: string) {
  const text = `${position} ${industry}`;
  for (const [key, grad] of GRAD_MAP) {
    if (text.includes(key)) return grad;
  }
  return 'linear-gradient(135deg,#4f46e5,#818cf8)';
}

// ─── 玻璃分区容器 ─────────────────────────────────────────────────────────────

function GlassSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card p-6">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-gtext-primary">
        <span className="text-gbrand-text">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

// ─── 使用步骤（静态文案）──────────────────────────────────────────────────────

const HOW_TO = [
  {
    t: '企业订阅',
    d: '由企业管理员订阅该员工，获得使用权。订阅是企业级的，一次订阅可在多处部署。',
  },
  {
    t: '创建实例',
    d: '在「员工实例」为具体部门创建实例。同一员工可创建多个实例，各自独立配置、互不影响。',
  },
  {
    t: '开通授权',
    d: '把实例授权给部门或具体成员，可设到期时间。被授权的人在「我的员工」里就能看到它。',
  },
  {
    t: '下载到本地运行',
    d: '员工以员工包形式下载到本地，放入你自己的运行环境即可使用；企业知识库留在本地不出内网。',
  },
];

// ─── page ────────────────────────────────────────────────────────────────────

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { token, hydrated } = useAuthStore();
  const loggedIn = hydrated && Boolean(token);

  // 走公开接口 —— 访客也要能看详情（不能用需登录的 useEmployee）
  const { data: emp, isLoading, isError } = useMarketEmployee(id);
  // 访客不请求订阅列表
  const { data: subs = [] } = useSubscriptions({ enabled: loggedIn });
  const subscribe = useSubscribe();

  // 支付弹窗开关。Hook 必须在早退分支之前声明。
  const [payOpen, setPayOpen] = useState(false);

  const subscribed = subs.some((s) => s.employee.id === id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-6 w-20 animate-pulse rounded-glass-md bg-glass-2" />
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-glass-2xl border border-glassline bg-glass-1"
          />
        ))}
      </div>
    );
  }

  // 未上架的员工后端返回 404，对访客表现为「不存在」
  if (isError || !emp) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="glass-card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-glassline bg-glass-2 text-gtext-muted">
            <Package className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[15px] font-medium text-gtext-primary">
              员工不存在或尚未上架
            </p>
            <p className="mt-1 text-[13px] text-gtext-secondary">
              它可能已下架，或链接有误。
            </p>
          </div>
          <Link href="/marketplace">
            <Button variant="glass-primary" size="sm">返回人才市场</Button>
          </Link>
        </div>
      </div>
    );
  }

  const grad = avatarGradient(emp.position ?? '', emp.industry ?? '');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-[13px] text-gtext-secondary transition-colors hover:text-gtext-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        返回
      </button>

      {/* 详情页五段式：我是谁 / 如何获得 / 我能做什么 / 如何使用 / 做得怎么样
          「如何获得」提到第二位 —— 访客看完介绍最想知道的是下一步怎么做 */}

      {/* 一 · 我是谁 */}
      <section className="glass-hero relative overflow-hidden p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-25 blur-3xl"
          style={{ background: grad }}
        />
        <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <div
            className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full text-3xl font-bold text-white shadow-glass-lg"
            style={{ background: grad }}
          >
            {emp.name.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold text-gtext-primary">{emp.name}</h1>
              <span className="rounded-full border border-glassline bg-glass-2 px-2 py-0.5 text-[11px] text-gtext-secondary">
                v{emp.version}
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-emerald-400">
                <PulsingDot className="h-1.5 w-1.5" />
                在线
              </span>
            </div>
            <p className="mt-1 text-[13px] text-gtext-secondary">
              {emp.position}
              {emp.industry ? ` · ${emp.industry}` : ''}
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-gtext-secondary">
              {emp.description || '暂无描述'}
            </p>
          </div>
        </div>
      </section>

      {/* 二 · 如何获得（前置：访客最想知道的下一步动作） */}
      <GlassSection icon={<Package className="h-4 w-4" />} title="如何获得">
        <div className="flex flex-wrap items-center gap-3">
          {subscribed ? (
            <>
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-400">
                <Check className="h-4 w-4" />
                本企业已订阅
              </span>
              {/* 订阅后的下一步是建实例，不是聊天（会话已暂停） */}
              <Link href="/instances">
                <Button variant="glass" size="sm">去创建实例</Button>
              </Link>
            </>
          ) : loggedIn ? (
            <Button
              variant="glass-primary"
              size="sm"
              disabled={subscribe.isPending}
              onClick={() => setPayOpen(true)}
            >
              订阅该员工
            </Button>
          ) : (
            <Link href={`/login?redirect=${encodeURIComponent(`/marketplace/${emp.id}`)}`}>
              <Button variant="glass-primary" size="sm">登录后订阅</Button>
            </Link>
          )}

          {typeof emp.price === 'number' && emp.price > 0 ? (
            <span className="text-[15px] font-semibold text-gtext-primary">
              ¥{emp.price}
              <span className="text-[12px] font-normal text-gtext-muted">/月</span>
            </span>
          ) : (
            <span className="text-[13px] font-medium text-emerald-400">免费</span>
          )}
        </div>
        <p className="mt-3 text-[12px] text-gtext-muted">
          订阅由企业管理员操作，作用于整个企业；普通成员如需使用，请联系管理员开通授权。
        </p>
      </GlassSection>

      {/* 三 · 我能做什么 */}
      <GlassSection icon={<Wrench className="h-4 w-4" />} title="我能做什么">
        {!emp.bindings || emp.bindings.length === 0 ? (
          <p className="text-[13px] text-gtext-muted">暂无绑定能力</p>
        ) : (
          <ul className="space-y-2.5">
            {[...emp.bindings]
              .sort((a, b) => a.order - b.order)
              .map((b) => {
                const cap = b.capability;
                const meta = CAPABILITY_TYPE_META[cap.type];
                return (
                  <li
                    key={b.id}
                    className="flex items-start gap-3 rounded-glass-lg border border-glassline bg-glass-2 p-3.5"
                  >
                    <span className="mt-0.5 shrink-0 rounded-full border border-glassline bg-glass-3 px-2 py-0.5 text-[11px] text-gtext-secondary">
                      {meta?.label ?? cap.type}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-gtext-primary">{cap.name}</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-gtext-muted">
                        {cap.description}
                      </p>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </GlassSection>

      {/* 四 · 如何使用 —— 纯静态说明，讲清从订阅到用起来的路径 */}
      <GlassSection icon={<PlayCircle className="h-4 w-4" />} title="如何使用">
        <ol className="space-y-3.5">
          {HOW_TO.map((s, i) => (
            <li key={s.t} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gbrand/20 text-[11px] font-semibold text-gbrand-text">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-gtext-primary">{s.t}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-gtext-muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </GlassSection>

      {/* 五 · 做得怎么样 —— 本期无履历上报，显式说明而非放假数字 */}
      <GlassSection icon={<BarChart3 className="h-4 w-4" />} title="做得怎么样">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: '已服务企业', value: String(emp._count?.subscriptions ?? 0), real: true },
            { label: '累计任务量', value: '—', real: false },
            { label: '任务成功率', value: '—', real: false },
          ].map((stat) => (
            <div
              key={stat.label}
              className={cn(
                'rounded-glass-lg p-4',
                stat.real
                  ? 'border border-glassline bg-glass-2'
                  : 'border border-dashed border-glassline bg-transparent',
              )}
            >
              <p className="text-[11px] text-gtext-muted">{stat.label}</p>
              <p
                className={cn(
                  'mt-1 text-xl font-semibold',
                  stat.real ? 'text-gtext-primary' : 'text-gtext-disabled',
                )}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
        {/* 空数据必须说清「为什么没有」，否则用户无法判断是没数据还是坏了 */}
        <p className="mt-3 text-[12px] leading-relaxed text-gtext-muted">
          员工在本地运行，任务量与成功率依赖客户端回传履历，本期尚未接入 ——
          故这两项暂无数据，而非为 0。「已服务企业」取自平台订阅记录，是真实值。
        </p>
      </GlassSection>

      {/* ── 支付确认 ─────────────────────────────────────────────────── */}
      <PaymentModal
        open={payOpen}
        emp={{ name: emp.name, price: emp.price }}
        subscribing={subscribe.isPending}
        onConfirm={() =>
          subscribe.mutate(emp.id, {
            onSuccess: () => {
              setPayOpen(false);
              toast.success(`已订阅「${emp.name}」，可去「员工实例」创建实例`);
            },
            onError: (e) =>
              toast.error(e instanceof ApiError ? e.message : '订阅失败'),
          })
        }
        onClose={() => setPayOpen(false)}
      />
    </div>
  );
}
