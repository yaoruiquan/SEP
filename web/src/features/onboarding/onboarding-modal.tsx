'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Building2, UserPlus, Briefcase, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
  useCreateDepartment,
  useCreateMember,
  useMarkOnboardingCompleted,
} from '@/features/enterprise/use-enterprise';

interface Props {
  onClose: () => void;
}

const TOTAL_STEPS = 5;

export function OnboardingModal({ onClose }: Props) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 2: 创建部门
  const [deptName, setDeptName] = useState('');
  const createDept = useCreateDepartment();

  // Step 3: 邀请成员
  const [emails, setEmails] = useState('');
  const createMember = useCreateMember();

  // Step 5: 完成
  const markCompleted = useMarkOnboardingCompleted();

  const nextStep = () => {
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleCreateDept = async () => {
    if (!deptName.trim()) {
      toast.error('请输入部门名称');
      return;
    }

    createDept.mutate(
      { name: deptName.trim() },
      {
        onSuccess: () => {
          toast.success(`部门「${deptName.trim()}」创建成功`);
          nextStep();
        },
        onError: (err) => {
          toast.error((err as Error).message || '创建失败');
        },
      }
    );
  };

  const handleInviteMembers = async () => {
    const emailList = emails
      .split('\n')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    if (emailList.length === 0) {
      // 跳过
      nextStep();
      return;
    }

    // MVP: 依次邀请，暂不并行（避免复杂的错误处理）
    let successCount = 0;
    for (const email of emailList) {
      try {
        await createMember.mutateAsync({
          email,
          password: 'Welcome123!', // MVP: 管理员代建账号，统一初始密码
          name: email.split('@')[0],
        });
        successCount++;
      } catch (err) {
        // 邮箱已存在等错误，继续处理其他邮箱
        console.warn(`邀请 ${email} 失败:`, err);
      }
    }

    if (successCount > 0) {
      toast.success(`成功邀请 ${successCount} 位成员`);
    }
    nextStep();
  };

  const handleComplete = async () => {
    markCompleted.mutate(undefined, {
      onSuccess: () => {
        onClose();
        toast.success('欢迎来到硅基员工平台！');
      },
      onError: (err) => {
        toast.error((err as Error).message || '完成失败');
      },
    });
  };

  const goToMarketplace = () => {
    router.push('/marketplace');
    handleComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Modal 主体 */}
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-background shadow-lg">
        {/* 步骤指示器 */}
        <div className="flex items-center justify-center gap-2 border-b border-border px-6 py-4">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
            const step = i + 1;
            return (
              <div
                key={step}
                className={`h-2 rounded-full transition-all ${
                  step === currentStep
                    ? 'bg-primary w-12'
                    : step < currentStep
                      ? 'bg-primary/50 w-8'
                      : 'bg-muted w-8'
                }`}
              />
            );
          })}
        </div>

        {/* 内容区 */}
        <div className="p-6">
          {/* Step 1: 欢迎页 */}
          {currentStep === 1 && (
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Briefcase className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">欢迎来到硅基员工平台！</h2>
                <p className="mt-2 text-fg-muted">
                  让我们用 3 步快速开始，体验 AI 员工的强大能力
                </p>
              </div>
              <Button onClick={nextStep} className="w-full" size="lg">
                开始
                <ChevronRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          )}

          {/* Step 2: 创建部门 */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Building2 className="h-8 w-8 text-primary" />
                </div>
                <h2 className="mt-4 text-xl font-bold">创建第一个部门</h2>
                <p className="mt-2 text-sm text-fg-muted">
                  先建一个部门，比如「营销部」或「技术部」
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">部门名称</label>
                <Input
                  placeholder="例如：营销部"
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  disabled={createDept.isPending}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateDept();
                    }
                  }}
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={nextStep}
                  disabled={createDept.isPending}
                  className="flex-1"
                >
                  跳过
                </Button>
                <Button
                  onClick={handleCreateDept}
                  disabled={createDept.isPending}
                  className="flex-1"
                >
                  {createDept.isPending ? '创建中...' : '创建'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: 邀请成员 */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <UserPlus className="h-8 w-8 text-primary" />
                </div>
                <h2 className="mt-4 text-xl font-bold">邀请团队成员</h2>
                <p className="mt-2 text-sm text-fg-muted">
                  邀请同事加入，一起使用 AI 员工
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">邮箱地址（每行一个）</label>
                <textarea
                  placeholder={'example1@company.com\nexample2@company.com'}
                  rows={5}
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  disabled={createMember.isPending}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-fg-muted">
                  初始密码为 Welcome123!，成员首次登录后可修改
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={nextStep}
                  disabled={createMember.isPending}
                  className="flex-1"
                >
                  跳过
                </Button>
                <Button
                  onClick={handleInviteMembers}
                  disabled={createMember.isPending}
                  className="flex-1"
                >
                  {createMember.isPending ? '邀请中...' : '邀请'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: 招聘第一个员工 */}
          {currentStep === 4 && (
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Briefcase className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold">招聘你的第一个 AI 员工</h2>
                <p className="mt-2 text-sm text-fg-muted">
                  去人才市场看看，挑选一个适合的 AI 员工
                </p>
              </div>
              <Button onClick={goToMarketplace} className="w-full" size="lg">
                前往市场
                <ChevronRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          )}

          {/* Step 5: 完成 */}
          {currentStep === 5 && (
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">🎉 设置完成！</h2>
                <p className="mt-2 text-fg-muted">
                  现在你可以开始使用硅基员工平台了
                </p>
              </div>
              <Button
                onClick={handleComplete}
                disabled={markCompleted.isPending}
                className="w-full"
                size="lg"
              >
                {markCompleted.isPending ? '正在完成...' : '进入工作台'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
