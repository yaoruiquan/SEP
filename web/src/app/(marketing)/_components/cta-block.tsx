import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Reveal } from './reveal';

/** 收尾 CTA（PRD §7.9）。.cta-block 提供 40px 圆角 + 内高光 + 品牌外发光。 */
export function CtaBlock() {
  return (
    <section aria-labelledby="cta-heading" className="px-6 py-24">
      <Reveal className="mx-auto max-w-5xl">
        <div className="cta-block glass-hero relative overflow-hidden px-8 py-16 text-center sm:px-16">
          {/* 局部光斑，避免整块玻璃太平 */}
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-gbrand/25 blur-3xl"
            aria-hidden
          />

          <div className="relative">
            <h2
              id="cta-heading"
              className="text-3xl font-bold tracking-tight sm:text-4xl"
            >
              <span className="gradient-text-glass inline-block">今天就让 AI 员工上岗</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-gtext-secondary">
              免费方案无需信用卡，注册后 5 分钟即可完成第一位数字员工的入职。
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/register"
                className="group inline-flex items-center gap-2 rounded-glass-pill bg-gbrand px-7 py-3.5 text-sm font-semibold text-white shadow-glass-md transition-all hover:bg-gbrand-hover hover:shadow-glass-lg"
              >
                免费开始
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  aria-hidden
                />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-glass-pill border border-glassline bg-glass-2 px-7 py-3.5 text-sm font-semibold text-gtext-primary backdrop-blur-glass-sm transition-all hover:border-glassline-hover hover:bg-glass-3"
              >
                预约演示
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gtext-muted">
              {['无需信用卡', '随时取消', '数据可导出'].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-gsuccess" aria-hidden />
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
