'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FAQS = [
  {
    q: '什么是硅基员工？',
    a: '硅基员工是具备独立身份、明确能力边界和工作记录的 AI 数字员工。与普通 AI 助手不同，每个硅基员工都可以被企业"招聘"并纳入正式的组织管理体系，就像管理真实员工一样。',
  },
  {
    q: '和普通 AI 对话工具有什么区别？',
    a: '普通 AI 工具是个人级别的，数据散落在每个人手中，无法统一管理。硅基员工平台以组织为核心，所有员工归属企业，权限受管理员控制，每次执行都有审计记录，结果可沉淀为企业资产。',
  },
  {
    q: '如何保障企业数据安全？',
    a: '平台支持企业知识库本地化存储，RBAC 角色权限控制员工可访问的数据范围，每次模型调用前会进行权限、隐私和合规过滤，输出结果也经过安全过滤，全程留有审计日志。',
  },
  {
    q: '支持哪些 AI 能力类型？',
    a: '平台通过统一适配层支持 Agent（如 Coze 扣子）、Skill 技能、RPA 自动化流程、n8n 等工作流平台，以及企业现有应用 API 的接入，MVP 阶段优先支持一到两种主要形态。',
  },
  {
    q: '企业可以自己开发并上架硅基员工吗？',
    a: '可以。平台开放开发者通道，按统一规范提交员工，经平台审核能力完整性、安全性和场景适用性后即可上架。企业也可以创建私有员工，仅供内部使用。',
  },
];

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 bg-background">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-foreground sm:text-4xl">常见问题</h2>
          <p className="mt-4 text-fg-muted">有疑问？我们来解答</p>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-left"
              >
                <span className="font-medium text-foreground">{faq.q}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200 ${open === i ? 'rotate-180' : ''}`}
                />
              </button>
              {open === i && (
                <div className="border-t border-border px-6 py-4 text-sm leading-7 text-fg-muted">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
