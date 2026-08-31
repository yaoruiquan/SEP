'use client';

import { ArrowRight, Boxes, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useIterableCapabilities } from './use-capability-iteration';

/**
 * 能力迭代列表。
 *
 * 会议决策 2 的入口页：企业能看到自己有哪些技能、改到第几版、多少人在用。
 * 与「能力贡献中心」分开是回应会议批评的「目录过度收拢」—— 那个是向平台投稿，
 * 这个是在本企业内部迭代，两件事的受众和动作都不一样。
 */
export function CapabilityIterationList() {
  const { data, isLoading, isError } = useIterableCapabilities();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-glass-lg border border-glassline bg-glass-1" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-glass-lg border border-gdanger/25 bg-gdanger/[0.06] px-4 py-8 text-center text-sm text-gdanger">
        能力列表加载失败，请稍后重试
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-12 text-center">
        <Boxes className="mx-auto h-6 w-6 text-gtext-disabled" />
        <p className="mt-3 text-sm font-medium text-gtext-secondary">还没有可迭代的技能</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-gtext-muted">
          企业雇佣硅基员工后，员工带的技能会出现在这里。你可以在本企业范围内编辑优化它们，
          改动经审核后生效，且不影响平台公共版本。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const scope = item.currentVersion?.scope;
        return (
          <Link
            key={item.capability.id}
            href={`/capabilities/${item.capability.id}`}
            className="group block rounded-glass-lg border border-glassline bg-glass-1 px-4 py-3.5 transition-all duration-200 hover:border-glassline-brand hover:bg-glass-2"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-[15px] font-semibold text-gtext-primary">{item.capability.name}</p>
                  {item.currentVersion ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-glass-pill border px-2 py-0.5 text-[10px] font-medium',
                        scope === 'ENTERPRISE'
                          ? 'border-glassline-brand bg-gbrand/10 text-gbrand-text'
                          : 'border-glassline bg-glass-2 text-gtext-secondary',
                      )}
                    >
                      {scope === 'ENTERPRISE' ? '企业版' : '平台版'} {item.currentVersion.version}
                    </span>
                  ) : (
                    // 没有选版记录不等于不能用 —— 执行时会兜底到最新平台审核通过版。
                    // 这里如实说「跟随平台版」而不是显示成异常状态。
                    <span className="rounded-glass-pill border border-glassline bg-glass-2 px-2 py-0.5 text-[10px] text-gtext-muted">
                      跟随平台版
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-gtext-muted">{item.capability.description}</p>
              </div>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gtext-muted transition-transform group-hover:translate-x-0.5 group-hover:text-gbrand-text" />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gtext-muted">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {item.employees.map((employee) => employee.employeeName).join('、')}
              </span>
              {/* 会议要求「企业可查看技能在本企业的使用人数」 */}
              {item.usage.distinctUserCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-gtext-secondary">
                  <Sparkles className="h-3 w-3" />
                  本企业 <span className="font-semibold tabular-nums text-gbrand-text">{item.usage.distinctUserCount}</span> 人在用
                  · {item.usage.totalRounds} 次调用
                </span>
              ) : (
                <span className="text-gtext-disabled">暂无使用记录</span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
