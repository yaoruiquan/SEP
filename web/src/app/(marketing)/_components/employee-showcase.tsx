"use client";

import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { useMarketEmployees } from "@/features/employee/use-employees";
import type { MarketEmployee } from "@/lib/types";
import { Reveal } from "./reveal";

const CAPABILITY_LABELS: Record<string, string> = {
  AGENT: "Agent",
  RPA: "RPA",
  SKILL: "Skill",
  AI_APP: "AI App",
};

function estimatedServiceCount(employee: MarketEmployee) {
  const subscriptions = employee._count?.subscriptions ?? 0;
  return Math.max(12, subscriptions * 9 + employee.bindings.length * 4);
}

function EmployeeCard({ employee }: { employee: MarketEmployee }) {
  const types = Array.from(
    new Set(
      employee.bindings
        .map((binding) => CAPABILITY_LABELS[binding.capability.type])
        .filter(Boolean),
    ),
  );

  return (
    <Link
      href={`/marketplace/${employee.id}`}
      className="glass-card glass-card-interactive mx-3 block w-[300px] shrink-0 p-5"
    >
      <article>
        <div className="mb-4 flex items-start gap-3">
          <Avatar
            name={employee.name}
            src={employee.avatar}
            className="h-12 w-12 shrink-0 rounded-glass-md shadow-glass-sm"
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-gtext-primary">
              {employee.name}
            </h3>
            <p className="truncate text-xs text-gtext-muted">
              {employee.position}
              {employee.industry ? ` · ${employee.industry}` : ""}
            </p>
          </div>
          <Badge variant="glass">{types[0] ?? "硅基员工"}</Badge>
        </div>

        <p className="mb-4 line-clamp-2 min-h-10 text-sm leading-relaxed text-gtext-secondary">
          {employee.description ||
            "为碳基团队提供可配置、可追踪的岗位协作能力。"}
        </p>

        <div className="flex items-center justify-between text-xs text-gtext-muted">
          <span className="flex items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-gbrand-text" aria-hidden />
            {employee.bindings.length} 项能力
          </span>
          <span className="flex items-center gap-1">
            <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden />约{" "}
            {estimatedServiceCount(employee)} 次服务
          </span>
        </div>
      </article>
    </Link>
  );
}

/** 从公开人才市场读取真实员工和头像，按订阅数排序后保持原有无限滚动效果。 */
export function EmployeeShowcase() {
  const { data: employees = [], isLoading, isError } = useMarketEmployees();
  const featured = [...employees]
    .sort(
      (a, b) => (b._count?.subscriptions ?? 0) - (a._count?.subscriptions ?? 0),
    )
    .slice(0, 8);

  return (
    <section
      id="showcase"
      aria-labelledby="showcase-heading"
      className="scroll-mt-28 py-24"
    >
      <div className="mx-auto mb-14 max-w-7xl px-6">
        <Reveal>
          <div className="text-center">
            <h2
              id="showcase-heading"
              className="text-3xl font-bold tracking-tight sm:text-4xl"
            >
              <span className="gradient-text-glass inline-block">
                热门硅基员工
              </span>
            </h2>
            <p className="mt-4 text-gtext-secondary">
              从真实人才市场挑选岗位，让硅基员工和碳基团队一起工作
            </p>
          </div>
        </Reveal>
      </div>

      {isLoading ? (
        <div
          className="flex gap-6 overflow-hidden px-3 py-2"
          aria-label="正在加载热门硅基员工"
        >
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="glass-card h-52 w-[300px] shrink-0 animate-pulse"
            />
          ))}
        </div>
      ) : featured.length > 0 ? (
        <div className="marquee-viewport">
          <div className="marquee-track py-2">
            <div className="flex">
              {featured.map((employee) => (
                <EmployeeCard key={employee.id} employee={employee} />
              ))}
            </div>
            <div className="flex" aria-hidden>
              {featured.map((employee) => (
                <EmployeeCard key={`dup-${employee.id}`} employee={employee} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-xl px-6 py-10 text-center text-sm text-gtext-muted">
          {isError
            ? "人才市场暂时无法加载，请直接浏览完整市场。"
            : "人才市场正在准备新的硅基员工。"}
        </div>
      )}

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
