'use client';

import { useRouter } from 'next/navigation';
import {
  Download,
  Key,
  BarChart3,
  Users,
  Clock,
  Wallet,
  Activity,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { CAPABILITY_TYPE_META } from '@/lib/utils';
import { capability } from '@/locales/zh-CN';
import type { MyEmployee } from '@/lib/types';
import type { useDownloadPackage } from '@/features/employee/use-packages';
import { useDownloadSkill } from '@/features/capability/use-capability';
import {
  formatLastUsed,
  formatSuccessRate,
  giftProgress,
} from '@/features/employee/usage-summary';
import { memo } from 'react';

interface EmployeeCardProps {
  employee: MyEmployee;
  isAdmin: boolean;
  download: ReturnType<typeof useDownloadPackage>;
  /** @deprecated WebSocket 未实现，保留字段但不用于展示假数据 */
  status?: 'online' | 'offline' | 'busy';
}

export const EmployeeCard = memo(function EmployeeCard({
  employee,
  isAdmin,
  download,
}: EmployeeCardProps) {
  const router = useRouter();
  const downloadSkill = useDownloadSkill();
  const {
    subscriptionId,
    name,
    templateVersion,
    employee: template,
    department,
    grantSource,
    expiresAt,
    packageAvailable,
    usage,
  } = employee;
  const gift = giftProgress(employee);

  const handleDownload = () => {
    download.mutate(
      // 包挂在员工模板上，不是雇佣关系上 —— 传 subscriptionId 会 404
      template.id,
      {
        onSuccess: ({ filename, sha256 }) => {
          const message = sha256
            ? `下载成功：${filename}\nSHA256: ${sha256}`
            : `下载成功：${filename}`;
          toast.success(message);
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  const handleDownloadSkills = async () => {
    const skills = template.bindings?.filter((b) => b.capability.type === 'SKILL') || [];
    if (skills.length === 0) {
      toast.error('该硅基员工暂无可下载的技能');
      return;
    }

    for (const skill of skills) {
      try {
        const { filename } = await downloadSkill.mutateAsync(skill.capability.id);
        toast.success(`${skill.capability.name} 下载成功`);
      } catch (err) {
        toast.error(`${skill.capability.name} 下载失败：${(err as Error).message}`);
      }
    }
  };

  return (
    <Card className="glass-card-interactive group h-full overflow-hidden">
      {/* 卡片头部 - 点击进入详情 */}
      <div
        onClick={() => router.push(`/my-employees/${subscriptionId}`)}
        className="cursor-pointer"
      >
        <CardHeader className="border-b border-glassline bg-gradient-to-br from-gbrand-text/10 via-transparent to-transparent p-5">
          <div className="flex items-start gap-4">
            {/* 头像 */}
            <div className="relative shrink-0">
              <Avatar
                name={template.name}
                src={template.avatar}
                className="h-14 w-14 shadow-glass-sm ring-2 ring-white/15 transition-transform group-hover:scale-105"
              />
            </div>

            {/* 员工信息 */}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-medium text-gtext-primary">{name}</h3>
              {/* 雇佣关系名默认就取模板名（数易租户 14 个全都一样）——
                  相同时只留版本号，否则第二行是标题的复读，看着像 bug */}
              <p className="mt-0.5 truncate text-xs text-gtext-secondary">
                {name !== template.name && <>{template.name} </>}
                <span className="opacity-60">v{templateVersion}</span>
              </p>
              <p className="mt-1.5 text-xs text-gtext-muted">
                {grantSource === 'DIRECT' ? '自助订阅' : grantSource === 'DEPARTMENT' ? '部门授权' : '未知'}
              </p>
            </div>
          </div>
        </CardHeader>
      </div>

      {/* 卡片内容 */}
      <CardContent className="space-y-4 p-5">
        {/* 使用情况 —— 会议2 §6.1「使用人数即口碑」。后端没算出来时整段不渲染 */}
        {usage && (
          <div className="space-y-1.5 rounded-md bg-glass-2 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-gtext-secondary">
                <Users className="h-3.5 w-3.5" />
                近 30 天在用
              </span>
              {/* 在用人数可能大于已授权人数：用过之后授权被收回/调岗都会这样，
                  这不是算错了，所以必须给出解释而不是把数字掐掉 */}
              <span
                className="text-gtext-primary"
                title={
                  usage.activeUserCount30d > usage.grantedUserCount
                    ? '在用人数统计近 30 天实际调用过的人，含之后被收回授权或调岗的成员，因此可能多于当前授权人数'
                    : '近 30 天在本企业内实际调用过的人数（去重），系统内部调用不计'
                }
              >
                {usage.activeUserCount30d} 人
                <span className="text-gtext-muted">
                  {' '}
                  / 已授权 {usage.grantedUserCount} 人
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-gtext-secondary">
                <Clock className="h-3.5 w-3.5" />
                上次使用
              </span>
              <span className="text-gtext-muted">{formatLastUsed(usage.lastUsedAt)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              {/* 唯一一行不是 30 天口径的 —— 自然月是为了能和账单对上，
                  所以必须在标签上写明，不能和上面几行混着读 */}
              <span className="flex items-center gap-1.5 text-gtext-secondary">
                <Wallet className="h-3.5 w-3.5" />
                本月消费
              </span>
              <span
                className="text-gtext-muted"
                title="自然月至今（非滚动 30 天），与账单、算力余额页的「本月算力消费」同口径"
              >
                ¥{Number(usage.monthCostCNY).toFixed(2)} · {usage.monthCallCount} 次调用
              </span>
            </div>
            {/* 成功率来自能力执行记录，与上面的「计费调用次数」不同源 —— 两个数不能相乘。
                必须带上分母：4/6 和 87/100 都是 67%，只给比例读者无法判断可信度 */}
            {usage.successRate30d !== null && (
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-gtext-secondary">
                  <Activity className="h-3.5 w-3.5" />
                  近 30 天成功率
                </span>
                <span
                  className={
                    usage.successRate30d >= 90
                      ? 'text-success'
                      : usage.successRate30d >= 70
                        ? 'text-warning'
                        : 'text-danger'
                  }
                  title="近 30 天能力执行成功次数 / 总执行次数。与上面的计费调用次数不同源，勿相乘"
                >
                  {formatSuccessRate(usage.successRate30d)}
                  <span className="text-gtext-muted">
                    {' '}
                    · {usage.executionCount30d} 次执行
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* 赠送算力进度 —— 用完后扣企业钱包，说清这一点用户才不会以为归零就不能用了 */}
        {gift && (
          <div className="space-y-1.5 rounded-md bg-glass-2 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gtext-secondary">赠送算力</span>
              <span
                className={gift.low ? 'text-warning' : 'text-gtext-muted'}
                title="赠送余额用完后，继续对话将从企业钱包余额扣除"
              >
                剩余 ¥{gift.remainingCNY.toFixed(2)} / ¥{gift.grantedCNY.toFixed(2)}
              </span>
            </div>
            {/* 条子画的是**剩余**，与上面那行「剩余 ¥x / ¥y」同向 —— 画已用的话
                额度充足时反而是一条空槽。用尽时把整条槽染成 danger：
                0 宽度的填充承载不了颜色。 */}
            <div
              className={`h-2 overflow-hidden rounded-full ${
                gift.exhausted ? 'bg-danger/30' : 'bg-glass-3'
              }`}
              role="progressbar"
              aria-label="赠送算力剩余比例"
              aria-valuenow={gift.remainingPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {/* 还剩一点点（四舍五入到 0%）时留个最小可见宽度，
                  否则「快用完」和「已用尽」在条子上长得一样 */}
              <div
                className={`h-full rounded-full transition-all ${
                  gift.low ? 'bg-warning' : 'bg-success'
                }`}
                style={{
                  width: `${gift.remainingPercent}%`,
                  minWidth: gift.exhausted ? undefined : 3,
                }}
              />
            </div>
            {gift.exhausted && (
              <p className="text-[11px] text-gtext-muted">
                赠送额度已用尽，后续消费从企业钱包扣除
              </p>
            )}
          </div>
        )}

        {/* 授权信息。「授权来源」已在卡片头部呈现，此处不再重复 */}
        {(department || expiresAt) && (
          <div className="space-y-1.5 rounded-md bg-glass-2 p-2.5">
            {department && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gtext-secondary">所属部门</span>
                <span className="text-gtext-muted">{department.name}</span>
              </div>
            )}
            {expiresAt && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gtext-secondary">授权到期</span>
                <span className="text-gtext-muted">
                  {new Date(expiresAt).toLocaleDateString('zh-CN')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 能力列表 */}
        {template.bindings && template.bindings.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gtext-secondary">{capability.ownedList}</p>
            <div className="flex flex-wrap gap-1.5">
              {template.bindings.map((binding) => {
                const meta = CAPABILITY_TYPE_META[binding.capability.type];
                return (
                  <Badge
                    key={binding.id}
                    className={`text-xs ${meta.tone}`}
                  >
                    {binding.capability.name}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="space-y-2">
          {/* 管理员操作。管理动作都收在雇佣关系页，这里只做跳转 */}
          {isAdmin && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="glass"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push('/subscriptions');
                }}
              >
                <Key className="h-3.5 w-3.5" />
                <span className="ml-1.5 text-xs">管理授权</span>
              </Button>
              <Button
                variant="glass"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push('/usage');
                }}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span className="ml-1.5 text-xs">统计</span>
              </Button>
            </div>
          )}

          {/* 下载按钮（所有人可见） */}
          {packageAvailable && (
            <Button
              variant="outline"
              size="sm"
              disabled={download.isPending}
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              className="w-full"
            >
              <Download className="mr-2 h-4 w-4" />
              {download.isPending ? '下载中...' : '下载硅基员工包'}
            </Button>
          )}

          {/* 下载技能包（会议决策：企业客户端下载待客户端产物落地后接入） */}
          {template.bindings?.some((b) => b.capability.type === 'SKILL') && (
            <Button
              variant="primary"
              size="sm"
              disabled={downloadSkill.isPending}
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadSkills();
              }}
              className="w-full bg-success hover:bg-success/90"
            >
              <Download className="mr-2 h-4 w-4" />
              {downloadSkill.isPending ? '下载中...' : capability.downloadPack}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
