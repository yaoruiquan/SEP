import { Search, UserPlus, Rocket } from "lucide-react";
import { Reveal } from "./reveal";

const STEPS = [
  {
    step: "01",
    icon: Search,
    title: "在市场发现",
    desc: "按行业、岗位和能力浏览已上架的硅基员工，先看清 TA 能做什么，再决定是否订阅。",
  },
  {
    step: "02",
    icon: UserPlus,
    title: "完成入职",
    desc: "使用余额或支付宝完成订阅，为 TA 设置企业内称呼，并接入需要的知识库。",
  },
  {
    step: "03",
    icon: Rocket,
    title: "授权协作",
    desc: "管理员把硅基员工授权给部门或指定碳基成员，成员即可发起任务并查看执行记录。",
  },
] as const;

/** 工作流程 3 步（PRD §7.5）。中间虚线连接由 .step-connector::after 绘制。 */
export function HowItWorks() {
  return (
    <section
      id="how"
      aria-labelledby="how-heading"
      className="scroll-mt-28 px-6 py-24"
    >
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="mb-14 text-center">
            <h2
              id="how-heading"
              className="text-3xl font-bold tracking-tight text-gtext-primary sm:text-4xl"
            >
              让硅基员工上岗，只需三步
            </h2>
            <p className="mt-4 text-gtext-secondary">
              从发现岗位到团队协作，流程清晰可控
            </p>
          </div>
        </Reveal>

        <div className="relative grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map(({ step, icon: Icon, title, desc }, i) => (
            <Reveal
              key={step}
              /* step-connector::after 绘制绝对定位的虚线，必须 relative */
              className="step-connector relative"
              delay={i * 100}
            >
              <div className="glass-card p-7 text-center">
                {/* 数字圆圈 */}
                <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center">
                  {/* 外圈品牌渐变 */}
                  <div
                    className="absolute inset-0 rounded-full bg-gradient-to-br from-gbrand to-violet-500 opacity-20"
                    aria-hidden
                  />
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gbrand/20 ring-1 ring-gbrand-text/30">
                    <Icon className="h-6 w-6 text-gbrand-text" aria-hidden />
                  </div>
                  {/* 步骤数字角标 */}
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gbrand text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                </div>

                <h3 className="mb-2 text-lg font-semibold text-gtext-primary">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-gtext-secondary">
                  {desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
