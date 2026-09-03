import { Zap, Network, MessageSquare, BarChart3, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

const CARDS = [
  {
    id: "subscribe",
    span: "sm:col-span-2 sm:row-span-2",
    icon: Zap,
    gradient: "from-violet-500 to-purple-600",
    title: "硅基员工，订阅即用",
    desc: "碳基团队从人才市场选中岗位，完成订阅、入职配置和知识库授权，就能开始协作。",
    large: true,
  },
  {
    id: "orchestration",
    span: "",
    icon: Network,
    gradient: "from-blue-500 to-indigo-600",
    title: "能力接入",
    desc: "Agent、RPA、Skill 与 AI App 都能成为硅基员工的一项工作能力。",
    large: false,
  },
  {
    id: "collaboration",
    span: "",
    icon: MessageSquare,
    gradient: "from-cyan-400 to-blue-500",
    title: "知识驱动协作",
    desc: "碳基成员直接发起对话，硅基员工结合企业知识按岗位完成任务。",
    large: false,
  },
  {
    id: "usage",
    span: "",
    icon: BarChart3,
    gradient: "from-indigo-500 to-violet-600",
    title: "执行可追踪",
    desc: "查看任务状态、能力调用、耗时和算力消耗，结果不再黑箱。",
    large: false,
  },
  {
    id: "security",
    span: "",
    icon: Shield,
    gradient: "from-pink-500 to-rose-600",
    title: "组织内授权",
    desc: "企业管理员按部门或成员授权，控制谁可以使用哪位硅基员工。",
    large: false,
  },
] as const;

/** Bento Grid 核心能力：主卡占 2×2，右侧四张能力卡填满两行。 */
export function BentoFeatures() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="scroll-mt-28 px-6 py-24"
    >
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="mb-14 text-center">
            <h2
              id="features-heading"
              className="text-3xl font-bold tracking-tight text-gtext-primary sm:text-4xl"
            >
              核心能力
            </h2>
            <p className="mt-4 text-gtext-secondary">
              让硅基劳动力进入碳基组织，而不是再多一个孤立工具
            </p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-4 sm:grid-rows-2">
          {CARDS.map(
            ({ id, span, icon: Icon, gradient, title, desc, large }, i) => (
              <Reveal key={id} className={span} delay={i * 60}>
                <div
                  className={cn(
                    "glass-card glass-card-interactive h-full p-6",
                    large && "flex flex-col justify-between",
                  )}
                >
                  {/* 图标 */}
                  <div
                    className={cn(
                      "mb-4 flex items-center justify-center rounded-full bg-gradient-to-br",
                      gradient,
                      large ? "h-14 w-14" : "h-10 w-10",
                    )}
                    aria-hidden
                  >
                    <Icon
                      className={
                        large ? "h-7 w-7 text-white" : "h-5 w-5 text-white"
                      }
                    />
                  </div>

                  <div>
                    <h3
                      className={cn(
                        "font-semibold text-gtext-primary",
                        large ? "mb-3 text-xl" : "mb-1.5 text-base",
                      )}
                    >
                      {title}
                    </h3>
                    <p
                      className={cn(
                        "leading-relaxed text-gtext-secondary",
                        large ? "text-base" : "text-sm",
                      )}
                    >
                      {desc}
                    </p>
                  </div>

                  {/* 大卡底部装饰 */}
                  {large && (
                    <div className="mt-8 flex gap-2" aria-hidden>
                      {["Agent", "RPA", "Skill", "AI App"].map((t) => (
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
            ),
          )}
        </div>
      </div>
    </section>
  );
}
