import Link from "next/link";
import { ArrowRight, Play, Bot, BarChart3, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Hero 中的 Dashboard 示意图（CSS + 内联 JSX，不依赖截图）。 */
function DashboardMockup() {
  return (
    <div className="glass-hero overflow-hidden">
      {/* 假标题栏 */}
      <div className="flex items-center gap-1.5 border-b border-glassline px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-gdanger/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-gwarning/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-gsuccess/70" />
        <span className="ml-3 text-xs text-gtext-muted">
          dashboard · 硅基人才平台
        </span>
      </div>

      <div className="flex min-h-0">
        {/* 侧栏 */}
        <aside className="flex w-32 flex-col gap-1 border-r border-glassline p-3">
          {[
            { label: "工作台", active: true },
            { label: "我的硅基员工", active: false },
            { label: "市场", active: false },
            { label: "设置", active: false },
          ].map(({ label, active }) => (
            <div
              key={label}
              className={`rounded-glass-sm px-2 py-1.5 text-xs ${
                active ? "bg-gbrand/20 text-gbrand-text" : "text-gtext-muted"
              }`}
            >
              {label}
            </div>
          ))}
        </aside>

        {/* 主区 */}
        <main className="flex-1 p-4">
          {/* 顶部指标行 */}
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[
              { label: "已授权员工", val: "6", up: true },
              { label: "本周任务", val: "38", up: true },
              { label: "剩余余额", val: "¥126", up: true },
            ].map(({ label, val, up }) => (
              <div key={label} className="glass-card p-3">
                <div className="text-[10px] text-gtext-muted">{label}</div>
                <div className="mt-0.5 text-sm font-bold gradient-text-glass inline-block">
                  {val}
                </div>
                <div
                  className={`text-[10px] ${up ? "text-gsuccess" : "text-gdanger"}`}
                >
                  {up ? "↑" : "↓"} 本周
                </div>
              </div>
            ))}
          </div>

          {/* 员工列表 */}
          <div className="glass-card overflow-hidden">
            <div className="border-b border-glassline px-3 py-2">
              <span className="text-xs font-medium text-gtext-secondary">
                任务执行 · 演示工作台
              </span>
            </div>
            {[
              { name: "营销助理", tag: "Agent", online: true },
              { name: "数据分析师", tag: "Skill", online: true },
              { name: "合规审核员", tag: "RPA", online: false },
            ].map(({ name, tag, online }) => (
              <div
                key={name}
                className="flex items-center justify-between border-b border-[rgba(255,255,255,0.10)] px-3 py-2 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gbrand/20">
                    <Bot className="h-3 w-3 text-gbrand-text" aria-hidden />
                  </div>
                  <span className="text-xs text-gtext-primary">{name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-glass-sm bg-glass-2 px-1.5 py-0.5 text-[10px] text-gtext-muted">
                    {tag}
                  </span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      online ? "bg-gsuccess" : "bg-gtext-disabled"
                    }`}
                    aria-label={online ? "在线" : "离线"}
                  />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Hero 区（PRD §7.2）。
 * 纯服务器组件，动画由 CSS 类驱动，不需要 'use client'。
 */
export function Hero() {
  return (
    <section
      aria-label="产品介绍"
      className="relative min-h-dvh overflow-hidden pt-28 pb-16 sm:pt-32 sm:pb-24"
    >
      {/* Aurora 背景 blobs */}
      <div className="aurora-layer" aria-hidden>
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>
      {/* Grid 叠加 */}
      <div
        className="aurora-grid pointer-events-none absolute inset-0 z-0"
        aria-hidden
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* 左侧文案 */}
          <div>
            {/* 更新角标 */}
            <div className="animate-fade-up mb-8 inline-flex items-center gap-2">
              <Badge variant="glass">
                <span className="flex h-1.5 w-1.5 shrink-0">
                  <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-gsuccess opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gsuccess" />
                </span>
                硅基员工 × 碳基团队
              </Badge>
            </div>

            <h1 className="animate-fade-up-d1 mb-3 text-[clamp(2.75rem,6vw,4.5rem)] font-bold leading-[1.08] tracking-[-0.03em]">
              <span className="gradient-text-glass inline-block">
                让公司从个体提效
              </span>
              <br />
              <span className="gradient-text-glass inline-block">
                到组织提效
              </span>
            </h1>

            <p className="animate-fade-up-d2 mb-4 text-lg font-medium text-gbrand-text">
              让硅基员工加入你的团队
            </p>

            <p className="animate-fade-up-d3 mb-10 max-w-lg text-base leading-relaxed text-gtext-secondary sm:text-lg">
              为碳基团队订阅一位真正能上岗的硅基员工。
              <br />
              从人才市场选择岗位，完成订阅、授权与配置，
              <br />
              再用自然语言把重复工作交给 TA。
            </p>

            <div className="animate-fade-up-d3 flex flex-wrap items-center gap-4">
              <Link
                href="/marketplace"
                className="group inline-flex items-center gap-2 rounded-glass-pill bg-gbrand px-6 py-3 text-sm font-semibold text-white shadow-glass-md transition-all hover:bg-gbrand-hover hover:shadow-glass-lg"
              >
                浏览硅基人才市场
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  aria-hidden
                />
              </Link>
              <Link
                href="#demo"
                className="inline-flex items-center gap-2 rounded-glass-pill border border-glassline bg-glass-2 px-6 py-3 text-sm font-semibold text-gtext-primary backdrop-blur-glass-sm transition-all hover:border-glassline-hover hover:bg-glass-3"
              >
                <Play className="h-4 w-4" aria-hidden />
                查看任务演示
              </Link>
            </div>

            {/* 信任徽章 */}
            <div className="animate-fade-up-d3 mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gtext-muted">
              {["支持余额与支付宝", "按部门或成员授权", "每次执行可追踪"].map(
                (t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <CheckCircle2
                      className="h-4 w-4 text-gsuccess"
                      aria-hidden
                    />
                    {t}
                  </span>
                ),
              )}
            </div>
          </div>

          {/* 右侧 3D Mockup */}
          <div id="demo" className="hero-mockup hidden lg:block scroll-mt-28">
            <DashboardMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
