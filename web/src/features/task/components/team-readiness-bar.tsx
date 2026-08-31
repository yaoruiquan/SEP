'use client';

import { Sparkles, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface TeamMemberBrief {
  id: string;
  name: string;
  avatar: string | null;
}

export interface TeamReadinessBarProps {
  enterpriseName?: string | null;
  members: TeamMemberBrief[];
  /** 覆盖人数（例如后端已给出总数，前端只拿到前 N 个头像） */
  count?: number;
  className?: string;
  /** 紧凑模式用于页面顶栏；默认是首屏那种大字号 */
  compact?: boolean;
}

/**
 * 「团队已就绪」条。
 *
 * 会议原话：*任务中心顶部应突出显示当前企业可用的硅基员工数量，例如「归集团队
 * 已准备好，目前团队成员18人」，数字需要明显展示*。
 *
 * 改造前这句话在输入框底部的 11px 小字里（task-objective-composer 的
 * `{employeeCount} 位员工在线`），是最容易被忽略的位置之一。
 *
 * 抽成共享组件是因为阶段三的企业首页要放同一条 —— 两处各写一份必然漂移，
 * 而这句话恰好是产品对外说的第一句话。
 */
export function TeamReadinessBar({
  enterpriseName,
  members,
  count,
  className,
  compact = false,
}: TeamReadinessBarProps) {
  const total = count ?? members.length;
  const visible = members.slice(0, compact ? 4 : 6);
  const teamLabel = enterpriseName?.trim() ? `${enterpriseName.trim()}团队` : '你的硅基团队';

  if (total === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-glass-lg border border-dashed border-glassline bg-glass-1 px-4 py-3',
          className,
        )}
      >
        <Users className="h-4 w-4 shrink-0 text-gtext-muted" />
        <p className="text-xs text-gtext-muted">
          还没有可调用的硅基员工 —— 先在「我的员工」里获得授权，或向管理员申请新增员工。
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-glass-lg border border-glassline bg-glass-1 px-4',
        compact ? 'py-2.5' : 'py-3.5',
        className,
      )}
    >
      <div className="flex items-center -space-x-2.5">
        {visible.map((member) => (
          <Avatar
            key={member.id}
            name={member.name}
            src={member.avatar}
            className={cn(
              'ring-2 ring-gbg-canvas',
              compact ? 'h-8 w-8 text-[10px]' : 'h-10 w-10 text-xs',
            )}
          />
        ))}
        {total > visible.length && (
          <span
            className={cn(
              'grid place-items-center rounded-full border border-glassline bg-glass-2 font-medium text-gtext-muted ring-2 ring-gbg-canvas',
              compact ? 'h-8 w-8 text-[10px]' : 'h-10 w-10 text-[11px]',
            )}
          >
            +{total - visible.length}
          </span>
        )}
      </div>

      <div className="min-w-0">
        {/* 数字用大字号 + 品牌色单独成块 —— 会议明确要求「数字需要明显展示」 */}
        <p
          className={cn(
            'flex flex-wrap items-baseline gap-x-1.5 font-semibold text-gtext-primary',
            compact ? 'text-[13px]' : 'text-base',
          )}
        >
          <span>{teamLabel}已准备好</span>
          <span className="text-gtext-muted">·</span>
          <span>目前团队成员</span>
          <span
            className={cn(
              'tabular-nums font-bold text-gbrand-text',
              compact ? 'text-lg' : 'text-2xl',
            )}
          >
            {total}
          </span>
          <span>人</span>
        </p>
        {!compact && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gtext-muted">
            <Sparkles className="h-3 w-3" />
            描述你的目标，我来安排合适的员工分工协作
          </p>
        )}
      </div>
    </div>
  );
}
