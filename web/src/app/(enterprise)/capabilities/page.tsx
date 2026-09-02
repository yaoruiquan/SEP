'use client';

import { CapabilityIterationList } from '@/features/capability-iteration/capability-iteration-list';
import { nav } from '@/locales/zh-CN';

/**
 * 技能库（会议决策 2）。
 *
 * 与「能力贡献中心」（向平台投稿）分开：会议批评过「目录过度收拢到一个模块」，
 * 企业内部改技能和向平台投稿是两件事，受众和动作都不同。
 *
 * 命名：会议给的是「能力迭代」，但决策 1 同时要求「减少技术化表达」——「迭代」
 * 正是技术词。改叫「技能库」后与同组的「知识库」对称（技能资产 / 文档资产），
 * 两类用户（成员改自己的、管理员定标准）都容得下。
 */
export default function CapabilitiesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8">
      <header>
        <h1 className="text-xl font-bold text-gtext-primary">{nav.capabilities}</h1>
        <p className="mt-1 text-xs leading-5 text-gtext-muted">
          企业雇佣的硅基员工带着这些技能。你可以创建自己的副本
          <span className="text-gtext-secondary">立即调整</span>
          ，管理员采纳后成为企业统一版本 —— 全程
          <span className="text-gtext-secondary">不影响平台公共版本</span>
          ，且随时可以退回旧版本。
        </p>
      </header>

      <CapabilityIterationList />
    </div>
  );
}
