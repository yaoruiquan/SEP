import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';

type Plan = {
  id: string;
  name: string;
  price: string;
  unit: string;
  desc: string;
  features: readonly string[];
  cta: string;
  href: string;
  featured?: boolean;
};

const PLANS: readonly Plan[] = [
  {
    id: 'starter',
    name: '体验版',
    price: '¥0',
    unit: '/ 月',
    desc: '适合个人和小团队先跑通一个场景',
    features: [
      '1 位硅基员工',
      '每月 500 次任务额度',
      '基础模型（对话 / 分析）',
      '社区支持',
    ],
    cta: '免费开始',
    href: '/register',
  },
  {
    id: 'team',
    name: '团队版',
    price: '¥1,980',
    unit: '/ 月',
    desc: '成长型企业的主力方案，按部门授权',
    features: [
      '10 位硅基员工',
      '每月 20,000 次任务额度',
      '全部模型 + 私有知识库',
      '部门与成员权限管理',
      '用量报表与审计日志',
      '工单支持（8h 响应）',
    ],
    cta: '开始 14 天试用',
    href: '/register?plan=team',
    featured: true,
  },
  {
    id: 'enterprise',
    name: '企业版',
    price: '定制',
    unit: '',
    desc: '需要私有部署、SSO 和合规审计的组织',
    features: [
      '不限硅基员工数量',
      '任务额度按需定制',
      '私有化部署 / VPC 隔离',
      'SSO（OIDC / SAML）',
      '专属客户成功经理',
      'SLA 99.95% 保障',
    ],
    cta: '联系销售',
    href: '/contact',
  },
] as const;

/** 定价（PRD §7.7）。推荐卡用 .gradient-border + .pricing-featured 双层强调。 */
export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-28 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="mb-14 text-center">
            <h2
              id="pricing-heading"
              className="text-3xl font-bold tracking-tight sm:text-4xl"
            >
              <span className="gradient-text-glass inline-block">按需订阅，随时调整</span>
            </h2>
            <p className="mt-4 text-gtext-secondary">
              所有方案都包含平台基础能力，超出额度按实际算力结算
            </p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 80}>
              <div
                className={cn(
                  'relative h-full p-8',
                  plan.featured
                    ? 'gradient-border pricing-featured glass-elevated lg:-translate-y-3 lg:scale-[1.04]'
                    : 'glass-card glass-card-interactive',
                )}
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-glass-pill bg-gbrand px-3 py-1 text-xs font-semibold text-white shadow-glass-sm">
                    最受欢迎
                  </span>
                )}

                <h3 className="text-lg font-semibold text-gtext-primary">{plan.name}</h3>
                <p className="mt-1.5 text-sm text-gtext-muted">{plan.desc}</p>

                <div className="mt-6 flex items-baseline gap-1">
                  <span
                    className={cn(
                      'text-4xl font-bold tracking-tight',
                      plan.featured
                        ? 'gradient-text-glass inline-block'
                        : 'text-gtext-primary',
                    )}
                  >
                    {plan.price}
                  </span>
                  {plan.unit && (
                    <span className="text-sm text-gtext-muted">{plan.unit}</span>
                  )}
                </div>

                <Link
                  href={plan.href}
                  className={cn(
                    'mt-7 flex w-full items-center justify-center rounded-glass-pill px-5 py-3 text-sm font-semibold transition-all',
                    plan.featured
                      ? 'bg-gbrand text-white shadow-glass-md hover:bg-gbrand-hover hover:shadow-glass-lg'
                      : 'border border-glassline bg-glass-2 text-gtext-primary backdrop-blur-glass-sm hover:border-glassline-hover hover:bg-glass-3',
                  )}
                >
                  {plan.cta}
                </Link>

                <ul className="mt-8 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-gtext-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-gsuccess" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-gtext-muted">
          所有价格均为不含税人民币。年付可享 2 个月折扣。
        </p>
      </div>
    </section>
  );
}
