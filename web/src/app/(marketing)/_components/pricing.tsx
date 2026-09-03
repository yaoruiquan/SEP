import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

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
    id: "starter",
    name: "先逛市场",
    price: "免费",
    unit: "",
    desc: "先了解每位硅基员工能做什么",
    features: [
      "浏览已上架员工",
      "查看岗位与能力说明",
      "公开员工详情",
      "无需登录即可开始",
    ],
    cta: "浏览人才市场",
    href: "/marketplace",
  },
  {
    id: "team",
    name: "企业订阅",
    price: "按员工定价",
    unit: "",
    desc: "订阅后由企业管理员完成入职配置",
    features: [
      "余额或支付宝支付",
      "企业内自定义称呼",
      "配置知识库与模型策略",
      "暂停、续费与版本管理",
    ],
    cta: "选择硅基员工",
    href: "/marketplace",
    featured: true,
  },
  {
    id: "enterprise",
    name: "团队协作",
    price: "按量结算",
    unit: "",
    desc: "让碳基成员在组织内安全使用硅基员工",
    features: [
      "按部门或成员授权",
      "对话与任务执行记录",
      "用量和算力消耗可查",
      "企业钱包统一管理",
    ],
    cta: "注册企业账号",
    href: "/register",
  },
] as const;

/** 定价（PRD §7.7）。推荐卡用 .gradient-border + .pricing-featured 双层强调。 */
export function Pricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="scroll-mt-28 px-6 py-24"
    >
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="mb-14 text-center">
            <h2
              id="pricing-heading"
              className="text-3xl font-bold tracking-tight text-gtext-primary sm:text-4xl"
            >
              按需订阅，随时调整
            </h2>
            <p className="mt-4 text-gtext-secondary">
              员工订阅费用与任务算力分开呈现，支付前均可确认
            </p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 80}>
              <div
                className={cn(
                  "relative h-full p-8",
                  plan.featured
                    ? "gradient-border pricing-featured glass-elevated lg:-translate-y-3 lg:scale-[1.04]"
                    : "glass-card glass-card-interactive",
                )}
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-glass-pill bg-gbrand px-3 py-1 text-xs font-semibold text-white shadow-glass-sm">
                    最受欢迎
                  </span>
                )}

                <h3 className="text-lg font-semibold text-gtext-primary">
                  {plan.name}
                </h3>
                <p className="mt-1.5 text-sm text-gtext-muted">{plan.desc}</p>

                <div className="mt-6 flex items-baseline gap-1">
                  {/*
                    唯一保留渐变的第二处。它和章节标题那种「装饰性渐变」不是一回事：
                    三张卡里只有主推那张的价格上色，作用是在同级卡片中区分出一张，
                    去掉它整个价格表就一样平了。其余装饰性用法已全部收掉。
                  */}
                  <span
                    className={cn(
                      "text-4xl font-bold tracking-tight",
                      plan.featured
                        ? "gradient-text-accent inline-block"
                        : "text-gtext-primary",
                    )}
                  >
                    {plan.price}
                  </span>
                  {plan.unit && (
                    <span className="text-sm text-gtext-muted">
                      {plan.unit}
                    </span>
                  )}
                </div>

                <Link
                  href={plan.href}
                  className={cn(
                    "mt-7 flex w-full items-center justify-center rounded-glass-pill px-5 py-3 text-sm font-semibold transition-all",
                    plan.featured
                      ? "bg-gbrand text-white shadow-glass-md hover:bg-gbrand-hover hover:shadow-glass-lg"
                      : "border border-glassline bg-glass-2 text-gtext-primary backdrop-blur-glass-sm hover:border-glassline-hover hover:bg-glass-3",
                  )}
                >
                  {plan.cta}
                </Link>

                <ul className="mt-8 space-y-3">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2.5 text-sm text-gtext-secondary"
                    >
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-gsuccess"
                        aria-hidden
                      />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-gtext-muted">
          实际费用以员工详情页和支付确认页展示为准。
        </p>
      </div>
    </section>
  );
}
