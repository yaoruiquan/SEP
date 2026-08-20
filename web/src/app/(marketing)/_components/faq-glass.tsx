import { ChevronDown } from "lucide-react";
import { Reveal } from "./reveal";

const FAQS = [
  {
    q: "什么是硅基员工，和碳基成员是什么关系？",
    a: "碳基成员是企业里的真实员工，硅基员工是围绕一个岗位封装的 AI 劳动力。硅基员工有明确的工作能力、权限边界和执行记录，由碳基成员发起任务、协作和复核。",
  },
  {
    q: "订阅后，谁可以使用硅基员工？",
    a: "企业管理员可以把已订阅的硅基员工授权给部门或指定成员。未被授权的成员不会出现在自己的员工列表中，管理员也可以随时暂停或调整授权。",
  },
  {
    q: "人才市场直接订阅和购物车订阅有什么区别？",
    a: "两种入口都支持余额支付和支付宝。直接订阅适合立即开通一位员工，购物车适合集中选择后统一确认；两处的支付宝支付流程彼此独立。",
  },
  {
    q: "可以给不同部门分配不同的员工吗？",
    a: "可以。雇佣一位员工后，可按部门或指定成员分别开通授权，未被授权的成员看不到该员工。管理员可以随时调整授权范围，并在审计日志里追溯每一次任务由谁发起。",
  },
  {
    q: "可以把企业知识库给硅基员工使用吗？",
    a: "可以。企业管理员可创建知识库并授权给已订阅的硅基员工，员工在对话和任务执行时会基于授权内容检索资料。",
  },
  {
    q: "如果硅基员工执行失败怎么办？",
    a: "每次任务都会保留状态、能力调用和耗时等执行记录。碳基成员可以根据记录修改输入后重新发起任务，管理员也能在用量与执行页面查看历史。",
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
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="scroll-mt-28 px-6 py-24"
    >
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <div className="mb-14 text-center">
            <h2
              id="faq-heading"
              className="text-3xl font-bold tracking-tight sm:text-4xl"
            >
              <span className="gradient-text-glass inline-block">常见问题</span>
            </h2>
            <p className="mt-4 text-gtext-secondary">
              关于订阅、授权、支付与团队协作
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
