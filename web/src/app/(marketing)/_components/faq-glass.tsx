import { ChevronDown } from 'lucide-react';
import { Reveal } from './reveal';

const FAQS = [
  {
    q: '硅基员工和直接调用大模型 API 有什么区别？',
    a: '硅基员工是被封装好的岗位角色：它自带提示词、可用工具、知识库和权限边界，开箱即用。直接调 API 你需要自己处理编排、上下文管理、工具接入和审计，这些平台已经做完了。',
  },
  {
    q: '我的业务数据会被用于训练模型吗？',
    a: '不会。企业数据仅在你自己的租户内用于任务执行与知识检索，不参与任何模型训练，也不会跨租户共享。可在企业设置中随时导出或删除。',
  },
  {
    q: '任务额度怎么计算，超出后会怎样？',
    a: '一次完整的任务执行记为一次额度消耗，无论中间调用了多少次模型。超出后不会中断服务，超额部分按实际算力单价结算，账单可在用量页面按天查看。',
  },
  {
    q: '可以给不同部门分配不同的员工吗？',
    a: '可以。员工实例支持按部门或指定成员授权，未被授权的成员看不到该员工。管理员可以随时调整授权范围，并在审计日志里追溯每一次任务由谁发起。',
  },
  {
    q: '支持接入我们自己的系统和数据库吗？',
    a: '支持。RPA 类能力可以对接内部系统完成跨系统操作，知识库支持上传文档或连接现有数据源。企业版还可以私有化部署在你的 VPC 内。',
  },
  {
    q: '如果员工执行出错怎么办？',
    a: '每次任务都有完整的执行轨迹，包括调用的工具、输入输出和耗时。失败任务可以一键重跑，关键操作支持人工确认后再执行，避免不可逆动作被自动触发。',
  },
] as const;

/**
 * FAQ（PRD §7.8）。
 *
 * 用原生 <details>/<summary> 而不是 Radix Accordion：无 JS 也能展开，
 * 键盘和读屏行为由浏览器保证，且不需要 'use client'。
 * 箭头旋转靠 group-open: 变体。
 */
export function FaqGlass() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-28 px-6 py-24">
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <div className="mb-14 text-center">
            <h2 id="faq-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
              <span className="gradient-text-glass inline-block">常见问题</span>
            </h2>
            <p className="mt-4 text-gtext-secondary">
              没找到答案？
              <a
                href="mailto:support@example.com"
                className="ml-1 text-gbrand-text underline-offset-4 hover:underline"
              >
                联系我们
              </a>
            </p>
          </div>
        </Reveal>

        <div className="space-y-4">
          {FAQS.map(({ q, a }, i) => (
            <Reveal key={q} delay={i * 60}>
              <details className="glass-card group overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-left text-base font-medium text-gtext-primary [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown
                    className="h-5 w-5 shrink-0 text-gtext-muted transition-transform duration-300 group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <p className="border-t border-glassline px-6 py-5 text-sm leading-relaxed text-gtext-secondary">
                  {a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
