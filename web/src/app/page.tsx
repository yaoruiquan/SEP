import Link from 'next/link';
import {
  Building2, Users, Lock, Zap, Shield, BarChart3,
  ArrowRight, Check, ChevronDown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FAQSection } from '@/components/landing/faq-section';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <img src="/favicon.ico" alt="logo" className="h-8 w-8 rounded-lg" />
            <span className="text-lg font-semibold">硅基员工人才市场</span>
          </div>
          <div className="flex items-center gap-8">
            <Link href="#features" className="text-sm text-fg-muted hover:text-foreground transition">
              产品功能
            </Link>
            <Link href="#pricing" className="text-sm text-fg-muted hover:text-foreground transition">
              定价方案
            </Link>
            <Link href="#faq" className="text-sm text-fg-muted hover:text-foreground transition">
              常见问题
            </Link>
            <div className="flex items-center gap-3">
              <Link href="/login">
                <Button variant="ghost" size="sm">登录</Button>
              </Link>
              <Link href="/register">
                <Button size="sm">免费注册</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="dot-grid-bg relative overflow-hidden py-24 sm:py-32">
        {/* Background orbs */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="animate-float absolute -left-40 top-1/4 h-[500px] w-[500px] rounded-full bg-primary/8 blur-3xl" />
          <div className="animate-float-slow absolute -right-40 bottom-1/4 h-[400px] w-[400px] rounded-full bg-orange-200/20 blur-3xl" />
        </div>

        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            {/* Badge */}
            <div className="animate-fade-up mb-8 relative inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm">
              <span className="shimmer-badge pointer-events-none absolute inset-0 rounded-full" />
              <span className="flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="text-fg-muted">🚀 全新上线 — 首个企业级硅基员工平台</span>
            </div>

            {/* Headline */}
            <h1 className="animate-fade-up-d1 mb-6 text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
              让 AI 从<span className="gradient-text-brand">个人提效</span>
              <br />
              到<span className="gradient-text-brand">组织提效</span>
            </h1>

            {/* Subtitle */}
            <p className="animate-fade-up-d2 mb-10 text-lg leading-8 text-fg-muted">
              硅基员工平台把 AI 能力包装为可招聘、可管理、可审计的数字员工，
              <br />
              帮助企业像管理真实团队一样管理 AI。
            </p>

            {/* CTA Buttons */}
            <div className="animate-fade-up-d3 flex flex-wrap items-center justify-center gap-4">
              <Link href="/marketplace">
                <Button size="lg" className="group">
                  浏览员工市场
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <Link href="#features">
                <Button variant="secondary" size="lg">
                  了解更多
                </Button>
              </Link>
            </div>

            {/* Stats */}
            <div className="animate-fade-up-d3 mt-16 grid grid-cols-3 gap-8 border-t border-border pt-10">
              <div>
                <div className="text-4xl font-black text-foreground">8+</div>
                <div className="mt-1 text-sm text-fg-muted">行业覆盖</div>
              </div>
              <div>
                <div className="text-4xl font-black text-foreground">120+</div>
                <div className="mt-1 text-sm text-fg-muted">硅基员工</div>
              </div>
              <div>
                <div className="text-4xl font-black text-foreground">500+</div>
                <div className="mt-1 text-sm text-fg-muted">企业在用</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 bg-muted/30">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-foreground sm:text-4xl">为什么选择硅基员工平台</h2>
            <p className="mt-4 text-lg text-fg-muted">不是工具，是真正融入企业组织的数字员工</p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Building2, title: '以组织为核心', desc: '员工归属企业部门，受权限体系控制。不是散乱的个人工具，而是纳入正式组织管理的数字成员。' },
              { icon: Users, title: '员工化，非工具化', desc: '每个硅基员工拥有独立身份、能力边界和工作履历。你雇用的是一个可承担职责的员工，不是一个接口。' },
              { icon: Zap, title: '开箱即用', desc: '招聘完成后分步引导配置，提供开展工作所需最小信息，即可开始执行任务，降低底层门槛。' },
              { icon: Lock, title: '权限精细可控', desc: 'RBAC 角色权限结合资源授权，控制成员能调用哪些员工、访问哪些数据、使用哪些工具。' },
              { icon: Shield, title: '全程可追溯', desc: '每次任务调用完整记录：谁发起、用了什么数据、调了哪个模型、耗了多少算力、输出了什么结果。' },
              { icon: BarChart3, title: '多平台统一接入', desc: '通过统一适配层接入 Agent、Skill、RPA 和工作流平台，屏蔽底层差异，对上提供一致的调用接口。' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="card-glow rounded-xl border border-border bg-card p-6 hover:border-primary/30 hover:shadow-md transition-all duration-200">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 font-semibold text-foreground">{title}</h3>
                <p className="text-sm leading-6 text-fg-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* How It Works */}
      <section className="py-24 bg-background">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-foreground sm:text-4xl">三步开始使用</h2>
            <p className="mt-4 text-lg text-fg-muted">从发现到上岗，最快一天完成</p>
          </div>
          <div className="relative grid grid-cols-1 gap-12 md:grid-cols-3">
            <div className="hidden md:block absolute top-8 left-1/3 right-1/3 border-t-2 border-dashed border-primary/20" />
            {[
              { step: '01', title: '发现招聘', desc: '在人才市场浏览 120+ 硅基员工，按行业和岗位筛选，查看能力说明和服务记录，一键订阅心仪的员工。' },
              { step: '02', title: '入职配置', desc: '创建企业专属员工实例，配置员工名称、所属部门、知识库和可用模型，分步引导完成入职绑定。' },
              { step: '03', title: '授权开工', desc: '将员工授权给部门或指定成员，成员即可发起任务，管理员随时查看执行状态和算力消耗。' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-orange-400">
                  <span className="text-2xl font-bold text-white">{step}</span>
                </div>
                <h3 className="mb-3 text-xl font-semibold text-foreground">{title}</h3>
                <p className="text-sm leading-7 text-fg-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* Pricing */}
      <section id="pricing" className="py-24 bg-muted/30">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-foreground sm:text-4xl">灵活的定价方案</h2>
            <p className="mt-4 text-lg text-fg-muted">按需选择，随时升级</p>
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:items-start">
            {([
              { name: '体验版', price: '免费', period: '', highlight: false, cta: '立即开始', href: '/register', features: ['2 个硅基员工', '10,000 算力点 / 月', '基础权限管理', '任务记录查看', '社区支持'] },
              { name: '专业版', price: '¥2,999', period: '/ 月', highlight: true, cta: '开始试用', href: '/register', features: ['20 个硅基员工', '100,000 算力点 / 月', '完整 RBAC 权限', '全量审计日志', 'API 接入支持', '优先技术支持'] },
              { name: '企业版', price: '联系销售', period: '', highlight: false, cta: '联系我们', href: '#', features: ['无限硅基员工', '自定义算力额度', '私有化部署', '企业知识库', '专属实施顾问', 'SLA 保障'] },
            ] as const).map(({ name, price, period, highlight, cta, href, features }) => (
              <div key={name} className={`rounded-2xl border p-8 ${highlight ? 'border-primary bg-primary text-white shadow-lg shadow-primary/20 scale-105 ring-2 ring-primary/30 shadow-xl shadow-primary/15' : 'card-glow border-border bg-card'}`}>
                {highlight && (
                  <div className="mb-4 inline-block rounded-full bg-white/20 px-3 py-0.5 text-xs font-medium text-white">⭐ 最受欢迎</div>
                )}
                <h3 className={`text-lg font-semibold ${highlight ? 'text-white' : 'text-foreground'}`}>{name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className={`text-4xl font-bold ${highlight ? 'text-white' : 'text-foreground'}`}>{price}</span>
                  <span className={`text-sm ${highlight ? 'text-white/70' : 'text-fg-muted'}`}>{period}</span>
                </div>
                <ul className="mt-8 space-y-3">
                  {features.map(f => (
                    <li key={f} className={`flex items-center gap-2 text-sm ${highlight ? 'text-white/90' : 'text-fg-muted'}`}>
                      <Check className={`h-4 w-4 shrink-0 ${highlight ? 'text-white' : 'text-primary'}`} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href={href} className="mt-8 block">
                  <Button variant={highlight ? 'secondary' : 'primary'} className="w-full" size="lg">{cta}</Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
      <FAQSection />

      {/* CTA */}
      <section className="py-24 bg-gradient-to-b from-background to-muted/40">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-foreground sm:text-4xl">
            准备好引入你的第一位<span className="text-primary">硅基员工</span>了吗？
          </h2>
          <p className="mt-4 text-lg text-fg-muted">免费注册，立即探索 120+ 硅基员工，无需信用卡</p>
          <p className="mt-3 text-sm text-fg-subtle">已有 500+ 企业在用 · 免费开始 · 随时取消</p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="group">
                免费开始使用
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link href="/marketplace">
              <Button variant="secondary" size="lg">浏览员工市场</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30 py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2">
              <img src="/favicon.ico" alt="logo" className="h-7 w-7 rounded-lg" />
              <span className="font-semibold">硅基员工人才市场</span>
            </div>
            <div className="flex items-center gap-8 text-sm text-fg-muted">
              <Link href="/marketplace" className="hover:text-foreground transition">员工市场</Link>
              <Link href="#pricing" className="hover:text-foreground transition">定价</Link>
              <Link href="#faq" className="hover:text-foreground transition">帮助</Link>
              <Link href="/login" className="hover:text-foreground transition">登录</Link>
            </div>
            <p className="text-sm text-fg-subtle">© 2026 硅基员工平台. 保留所有权利.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
