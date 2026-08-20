"use client";

import { useEffect, useRef, useState } from "react";
import { useMarketEmployees } from "@/features/employee/use-employees";
import { Reveal } from "./reveal";

function useCountUp(target: number, decimals = 0, enabled: boolean) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const duration = 1800;
    const start = performance.now();
    let raf: number;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(parseFloat((target * eased).toFixed(decimals)));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, decimals, enabled]);

  return current;
}

function CountStat({
  value,
  suffix,
  label,
  decimals = 0,
}: {
  value: number;
  suffix: string;
  label: string;
  decimals?: number;
}) {
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = useCountUp(value, decimals, started);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="flex flex-col items-center gap-1 py-4">
      <span className="text-3xl font-black tracking-tight sm:text-4xl">
        <span className="gradient-text-glass inline-block">
          {decimals > 0 ? current.toFixed(decimals) : Math.round(current)}
        </span>
        <span className="gradient-text-glass text-2xl">{suffix}</span>
      </span>
      <span className="text-sm text-gtext-secondary">{label}</span>
    </div>
  );
}

/** 数据信任条（PRD §7.3）。进入视口时 count-up 动画触发。 */
export function TrustBar() {
  const { data: employees = [] } = useMarketEmployees();
  const stats = [
    { value: employees.length, suffix: "", label: "已上架硅基员工" },
    { value: 18, suffix: "+", label: "服务企业" },
    { value: 1200, suffix: "+", label: "累计任务执行" },
    { value: 4, suffix: " 类", label: "能力接入类型" },
  ] as const;

  return (
    <section aria-label="平台数据" className="relative z-10 px-6 py-4">
      <Reveal>
        <div className="mx-auto max-w-4xl">
          <div className="glass-card grid grid-cols-2 divide-x divide-y divide-glassline sm:grid-cols-4 sm:divide-y-0">
            {stats.map((s) => (
              <CountStat key={s.label} {...s} />
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
