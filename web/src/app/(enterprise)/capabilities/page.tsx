'use client';

import { CapabilityIterationList } from '@/features/capability-iteration/capability-iteration-list';
import { nav } from '@/locales/zh-CN';

/**
 * 能力迭代（决策 2）。
 *
 * 与「能力贡献中心」（向平台投稿）分开：会议批评过「目录过度收拢到一个模块」，
 * 企业内部迭代和向平台投稿是两件事，受众和动作都不同。
 */
export default function CapabilitiesPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-8">
      <header>
        <h1 className="text-xl font-bold text-gtext-primary">{nav.capabilities}</h1>
        <p className="mt-1 text-xs leading-5 text-gtext-muted">
          企业可以在本企业范围内编辑优化已有技能。改动经审核后生效，
          <span className="text-gtext-secondary">不影响平台公共版本</span>，且随时可以退回旧版本。
        </p>
      </header>

      <CapabilityIterationList />
    </div>
  );
}
