'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/lib/auth-store';
import { ApiError } from '@/lib/api-client';
import { useLeaveEnterprise } from './use-auth';

export function LeaveEnterprisePanel({ invitationToken }: { invitationToken?: string | null }) {
  const { enterprise, roleInEnterprise } = useAuthStore();
  const leave = useLeaveEnterprise(invitationToken);
  const [confirming, setConfirming] = useState(false);

  if (!enterprise) return null;

  const serverError = leave.error instanceof ApiError
    ? leave.error.message
    : leave.error ? '离职失败，请稍后重试' : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>退出企业</CardTitle>
        <CardDescription>
          解除与「{enterprise.name}」的归属关系，保留账号。之后可以接受新的企业邀请或自行开通公司。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-glassline bg-glass-2 px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
          <p className="font-medium text-foreground">会发生什么</p>
          <p className="mt-1">
            立即回收：你被授权的硅基员工席位、你的部门归属，并取消你提交的待审批申请。
          </p>
          <p className="mt-0.5">
            保留在企业：技能配置、知识库、工作与审批记录。这些属于企业，离职不会带走。
          </p>
          <p className="mt-0.5">保留在你名下：账号本身与历史对话。</p>
          {roleInEnterprise === 'ENTERPRISE_ADMIN' && (
            <p className="mt-1.5 text-warning">
              你是企业管理员。若你是唯一的管理员，需先指定另一位管理员才能退出。
            </p>
          )}
        </div>

        {invitationToken && (
          <p className="text-xs leading-relaxed text-fg-muted">
            无需注销账号。退出成功后将返回邀请页面，由你确认是否加入新企业。
          </p>
        )}
        {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}

        {!confirming ? (
          <Button
            variant="danger"
            size="sm"
            className="h-auto min-h-8 max-w-full whitespace-normal break-all py-2 text-left"
            onClick={() => setConfirming(true)}
          >
            退出「{enterprise.name}」
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => leave.mutate()}
              disabled={leave.isPending}
            >
              {leave.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              确认退出
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={leave.isPending}>
              取消
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
