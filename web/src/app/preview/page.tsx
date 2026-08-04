'use client';

import { useState } from 'react';
import { Skeleton, CardSkeleton, TableSkeleton } from '@/components/ui/skeleton';
import { Drawer } from '@/components/ui/drawer';
import { Steps, Step } from '@/components/ui/steps';
import { StatusDot } from '@/components/ui/status-dot';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function ComponentPreviewPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  const steps: Step[] = [
    { id: '1', title: '选择员工', description: '从市场选择数字员工' },
    { id: '2', title: '配置信息', description: '设置名称和描述' },
    { id: '3', title: '绑定能力', description: '为员工绑定能力' },
    { id: '4', title: '确认招募', description: '确认信息并完成' },
    { id: '5', title: '完成', description: '员工已加入团队' },
  ];

  return (
    <div className="p-8 space-y-12 bg-neutral-50 min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-neutral-900 mb-2">组件视觉测试</h1>
        <p className="text-neutral-600">阶段一基础组件展示</p>
      </div>

      {/* Skeleton */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-neutral-900">Skeleton 骨架屏</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card variant="solid" className="p-6 space-y-4">
            <h3 className="text-sm font-medium text-neutral-700 mb-4">基础形态</h3>
            <div className="space-y-3">
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="rectangular" width="100%" height={100} />
              <div className="flex items-center gap-3">
                <Skeleton variant="circular" width={40} height={40} />
                <div className="flex-1 space-y-2">
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="40%" />
                </div>
              </div>
            </div>
          </Card>

          <Card variant="solid" className="p-6">
            <h3 className="text-sm font-medium text-neutral-700 mb-4">预设：CardSkeleton</h3>
            <CardSkeleton />
          </Card>

          <Card variant="solid" className="p-6 lg:col-span-2">
            <h3 className="text-sm font-medium text-neutral-700 mb-4">预设：TableSkeleton</h3>
            <TableSkeleton rows={5} />
          </Card>
        </div>
      </section>

      {/* StatusDot */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-neutral-900">StatusDot 状态指示器</h2>
        <Card variant="solid" className="p-6">
          <div className="flex flex-wrap gap-8">
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-neutral-700">小尺寸</h3>
              <div className="flex items-center gap-4">
                <StatusDot status="online" size="sm" showLabel />
                <StatusDot status="busy" size="sm" showLabel />
                <StatusDot status="offline" size="sm" showLabel />
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-neutral-700">中尺寸（默认）</h3>
              <div className="flex items-center gap-4">
                <StatusDot status="online" showLabel />
                <StatusDot status="busy" showLabel />
                <StatusDot status="offline" showLabel />
              </div>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-neutral-700">大尺寸</h3>
              <div className="flex items-center gap-4">
                <StatusDot status="online" size="lg" showLabel />
                <StatusDot status="busy" size="lg" showLabel />
                <StatusDot status="offline" size="lg" showLabel />
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* ProgressBar */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-neutral-900">ProgressBar 进度条</h2>
        <Card variant="solid" className="p-6 space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-700">不同变体</h3>
            <ProgressBar value={30} variant="default" showLabel label="默认进度" />
            <ProgressBar value={60} variant="success" showLabel label="成功" />
            <ProgressBar value={45} variant="warning" showLabel label="警告" />
            <ProgressBar value={85} variant="danger" showLabel label="危险" />
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-700">不同尺寸</h3>
            <ProgressBar value={70} size="sm" showLabel label="小尺寸" />
            <ProgressBar value={70} size="md" showLabel label="中尺寸（默认）" />
            <ProgressBar value={70} size="lg" showLabel label="大尺寸" />
          </div>
        </Card>
      </section>

      {/* Steps */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-neutral-900">Steps 步骤条</h2>
        <Card variant="solid" className="p-6 space-y-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-neutral-700">横向步骤条（可点击）</h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                  disabled={currentStep === 0}
                >
                  上一步
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setCurrentStep(Math.min(steps.length - 1, currentStep + 1))}
                  disabled={currentStep === steps.length - 1}
                >
                  下一步
                </Button>
              </div>
            </div>
            <Steps
              steps={steps}
              currentStep={currentStep}
              orientation="horizontal"
              clickable
              onStepClick={setCurrentStep}
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-neutral-700">纵向步骤条（只读）</h3>
            <Steps
              steps={steps}
              currentStep={currentStep}
              orientation="vertical"
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-neutral-700">带错误状态</h3>
            <Steps
              steps={[
                { id: '1', title: '第一步', status: 'completed' },
                { id: '2', title: '第二步', status: 'completed' },
                { id: '3', title: '第三步（错误）', status: 'error', description: '验证失败' },
                { id: '4', title: '第四步', status: 'pending' },
              ]}
              currentStep={2}
              orientation="horizontal"
            />
          </div>
        </Card>
      </section>

      {/* Drawer */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-neutral-900">Drawer 抽屉</h2>
        <Card variant="solid" className="p-6">
          <div className="flex gap-4">
            <Button variant="primary" onClick={() => setDrawerOpen(true)}>
              打开抽屉（右侧）
            </Button>
          </div>
        </Card>
      </section>

      {/* ConfirmDialog */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-neutral-900">ConfirmDialog 确认对话框</h2>
        <Card variant="solid" className="p-6">
          <div className="flex gap-4">
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              危险操作（删除）
            </Button>
          </div>
        </Card>
      </section>

      {/* 能力类型颜色 */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-neutral-900">能力类型颜色</h2>
        <Card variant="solid" className="p-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className="w-12 h-12 rounded-lg bg-capability-agent" />
              <span className="text-sm text-neutral-700">Agent</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-12 h-12 rounded-lg bg-capability-skill" />
              <span className="text-sm text-neutral-700">Skill</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-12 h-12 rounded-lg bg-capability-rpa" />
              <span className="text-sm text-neutral-700">RPA</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-12 h-12 rounded-lg bg-capability-aiapp" />
              <span className="text-sm text-neutral-700">AI App</span>
            </div>
          </div>
        </Card>
      </section>

      {/* Drawer 实例 */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="员工详情"
        width="lg"
      >
        <div className="space-y-6">
          <div className="flex items-center gap-4 p-4 bg-neutral-50 rounded-lg">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-2xl">🤖</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">AI 助手小明</h3>
              <p className="text-sm text-neutral-600">智能客服助手</p>
              <StatusDot status="online" showLabel className="mt-2" />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium text-neutral-900">基本信息</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-600">员工类型</span>
                <span className="text-neutral-900">数字员工</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">绑定能力</span>
                <span className="text-neutral-900">5 个</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">创建时间</span>
                <span className="text-neutral-900">2024-01-15</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium text-neutral-900">当前任务</h4>
            <ProgressBar value={65} variant="success" showLabel label="客户咨询处理" />
          </div>

          <div className="pt-4 border-t border-neutral-200 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setDrawerOpen(false)}>
              关闭
            </Button>
            <Button variant="primary" className="flex-1">
              编辑员工
            </Button>
          </div>
        </div>
      </Drawer>

      {/* ConfirmDialog 实例 */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="确认删除"
        description="此操作将永久删除该员工及其所有数据，无法恢复。确定要继续吗？"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          alert('已删除');
        }}
      />
    </div>
  );
}
