import {
  Zap, Network, MessageSquare, BarChart3, Shield, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';

const CARDS = [
  {
    id: 'subscribe',
    span: 'sm:col-span-2 sm:row-span-2',
    icon: Zap,
    gradient: 'from-violet-500 to-purple-600',
    title: '订阅即用',
    desc: '无需部署，选中员工、配置权限，立即开始协作。从注册到第一次对话，最快 5 分钟。',
    large: true,
  },
  {
    id: 'orchestration',
    span: '',
    icon: Network,
    gradient: 'from-blue-500 to-indigo-600',
    title: '硅基能力编排',
    desc: 'Agent / RPA / Skill / AI 应用统一 execute() 接口，透明编排。',
    large: false,
  },
  {
    id: 'realtime',
    span: '',
    icon: MessageSquare,
    gradient: 'from-cyan-400 to-blue-500',
    title: '实时对话',
    desc: 'ChatGPT 式流式响应，SSE 驱动，毫秒级首字。',
    large: false,
  },
  {
    id: 'usage',
    span: '',
    icon: BarChart3,
    gradient: 'from-indigo-500 to-violet-600',
    title: '用量透明',
    desc: 'Token 级计费与监控，每次调用完整留痕。',
    large: false,
  },
  {
    id: 'security',
    span: '',
    icon: Shield,
    gradient: 'from-pink-500 to-rose-600',
    title: '企业级安全',
    desc: 'RBAC 权限、数据隔离、审计日志、合规过滤。',
    large: false,
  },
  {
    id: 'open',
    span: '',
    icon: Globe,
    gradient: 'from-emerald-400 to-teal-600',
    title: '开放生态',
    desc: '贡献者可上传自定义能力，审核通过即可全网销售。',
    large: false,
  },
] as const;

/** Bento Grid 核心能力（PRD §7.4）。4 列不规则网格，大卡占 2×2。 */
export function BentoFeatures() {
  return (
    <section id="features" aria-labelledby="features-heading" className="scroll-mt-28 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="mb-14 text-center">
            <h2
              id="features-heading"
              className="text-3xl font-bold tracking-tight sm:text-4xl"
            >
              <span className="gradient-text-glass inline-block">核心能力</span>
            </h2>
            <p className="mt-4 text-gtext-secondary">
              不是工具，是真正融入企业组织的硅基员工
            </p>
          </div>
        </Reveal>

        {/* 4 列网格 */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-4 sm:grid-rows-2">
          {CARDS.map(({ id, span, icon: Icon, gradient, title, desc, large }, i) => (
            <Reveal key={id} className={span} delay={i * 60}>
              <div
                className={cn(
                  'glass-card glass-card-interactive h-full p-6',
                  large && 'flex flex-col justify-between',
                )}
              >
                {/* 图标 */}
                <div
                  className={cn(
                    'mb-4 flex items-center justify-center rounded-full bg-gradient-to-br',
                    gradient,
                    large ? 'h-14 w-14' : 'h-10 w-10',
                  )}
                  aria-hidden
                >
                  <Icon className={large ? 'h-7 w-7 text-white' : 'h-5 w-5 text-white'} />
                </div>

                <div>
                  <h3
                    className={cn(
                      'font-semibold text-gtext-primary',
                      large ? 'mb-3 text-xl' : 'mb-1.5 text-base',
                    )}
                  >
                    {title}
                  </h3>
                  <p
                    className={cn(
                      'leading-relaxed text-gtext-secondary',
                      large ? 'text-base' : 'text-sm',
                    )}
                  >
                    {desc}
                  </p>
                </div>

                {/* 大卡底部装饰 */}
                {large && (
                  <div className="mt-8 flex gap-2" aria-hidden>
                    {['Agent', 'RPA', 'Skill', 'AI App'].map((t) => (
                      <span
                        key={t}
                        className="rounded-glass-pill border border-glassline-brand bg-gbrand/10 px-2.5 py-1 text-xs text-gbrand-text"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
