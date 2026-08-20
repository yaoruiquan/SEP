import Link from 'next/link';
import { ArrowRight, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Reveal } from './reveal';

type Employee = {
  name: string;
  role: string;
  type: 'Agent' | 'RPA' | 'Skill' | 'AI App';
  desc: string;
  rating: string;
  runs: string;
  initial: string;
  gradient: string;
};

const EMPLOYEES: readonly Employee[] = [
  {
    name: '林小析',
    role: '数据分析师',
    type: 'Agent',
    desc: '接入业务库自动出日报、异常归因、趋势预测。',
    rating: '4.9',
    runs: '12.4k',
    initial: '析',
    gradient: 'from-blue-500 to-cyan-400',
  },
  {
    name: '周文笔',
    role: '内容运营',
    type: 'Skill',
    desc: '按品牌语调批量产出文案、公众号与投放素材。',
    rating: '4.8',
    runs: '9.7k',
    initial: '文',
    gradient: 'from-violet-500 to-fuchsia-400',
  },
  {
    name: '陈对账',
    role: '财务专员',
    type: 'RPA',
    desc: '跨系统抓单、三方对账、差异清单一键导出。',
    rating: '4.9',
    runs: '8.1k',
    initial: '账',
    gradient: 'from-amber-500 to-orange-400',
  },
  {
    name: '苏客服',
    role: '客户成功',
    type: 'AI App',
    desc: '基于知识库多轮应答，工单自动分级与转派。',
    rating: '4.7',
    runs: '15.2k',
    initial: '客',
    gradient: 'from-emerald-500 to-teal-400',
  },
  {
    name: '何招聘',
    role: 'HR 助理',
    type: 'Agent',
    desc: '简历筛选打分、面试安排、候选人跟进提醒。',
    rating: '4.8',
    runs: '6.3k',
    initial: '招',
    gradient: 'from-rose-500 to-pink-400',
  },
  {
    name: '吴测试',
    role: 'QA 工程师',
    type: 'Skill',
    desc: '读需求生成用例，跑回归并输出缺陷报告。',
    rating: '4.6',
    runs: '5.5k',
    initial: '测',
    gradient: 'from-indigo-500 to-blue-400',
  },
] as const;

function EmployeeCard({ e }: { e: Employee }) {
  return (
    <article className="glass-card glass-card-interactive mx-3 w-[300px] shrink-0 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-glass-md bg-gradient-to-br ${e.gradient} text-base font-semibold text-white`}
          aria-hidden
        >
          {e.initial}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-gtext-primary">{e.name}</h3>
          <p className="truncate text-xs text-gtext-muted">{e.role}</p>
        </div>
        <Badge variant="glass">{e.type}</Badge>
      </div>

      <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-gtext-secondary">{e.desc}</p>

      <div className="flex items-center justify-between text-xs text-gtext-muted">
        <span className="flex items-center gap-1">
          <Star className="h-3.5 w-3.5 fill-gwarning text-gwarning" aria-hidden />
          {e.rating}
        </span>
        <span>{e.runs} 次服务</span>
      </div>
    </article>
  );
}

/**
 * 员工展示走马灯（PRD §7.6）。
 *
 * 无限滚动靠 .marquee-track 里放两份完全相同的内容 + width:max-content，
 * 动画平移 -50% 时正好接回第一份的起点，视觉上无缝。
 * 第二份对读屏软件是重复噪音，用 aria-hidden 屏蔽。
 */
export function EmployeeShowcase() {
  return (
    <section aria-labelledby="showcase-heading" className="py-24">
      <div className="mx-auto mb-14 max-w-7xl px-6">
        <Reveal>
          <div className="text-center">
            <h2
              id="showcase-heading"
              className="text-3xl font-bold tracking-tight sm:text-4xl"
            >
              <span className="gradient-text-glass inline-block">热门硅基员工</span>
            </h2>
            <p className="mt-4 text-gtext-secondary">
              156 位硅基员工覆盖数据、财务、内容、客服等 12 个职能
            </p>
          </div>
        </Reveal>
      </div>

      {/* 走马灯：整体装饰性，语义内容已在下方"查看全部"链接后的市场页 */}
      <div className="marquee-viewport">
        <div className="marquee-track py-2">
          <div className="flex">
            {EMPLOYEES.map((e) => (
              <EmployeeCard key={e.name} e={e} />
            ))}
          </div>
          <div className="flex" aria-hidden>
            {EMPLOYEES.map((e) => (
              <EmployeeCard key={`dup-${e.name}`} e={e} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-12 text-center">
        <Link
          href="/marketplace"
          className="group inline-flex items-center gap-2 rounded-glass-pill border border-glassline bg-glass-2 px-6 py-3 text-sm font-semibold text-gtext-primary backdrop-blur-glass-sm transition-all hover:border-glassline-hover hover:bg-glass-3"
        >
          浏览全部员工
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-1"
            aria-hidden
          />
        </Link>
      </div>
    </section>
  );
}
