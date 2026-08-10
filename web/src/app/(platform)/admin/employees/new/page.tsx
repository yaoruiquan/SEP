'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { adminApi } from '@/features/admin/admin-api';
import { useAvailableCapabilities, useBindCapabilities } from '@/features/admin/use-admin';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NewEmployeePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    industry: '通用',
    position: '通用',
    avatar: '',
    systemPrompt: '你是一位专业的硅基员工，随时准备协助用户完成各项任务。',
    modelId: 'gpt-4o',
    maxSteps: 10,
    price: 0,
  });

  const { data: capabilitiesData, isLoading: capabilitiesLoading } = useAvailableCapabilities();

  // Hook 已经提取了 items 数组，添加防御性检查
  const capabilities = Array.isArray(capabilitiesData) ? capabilitiesData : [];
  const bindCapabilitiesMutation = useBindCapabilities();

  const industries = [
    '通用',
    '电商',
    '金融',
    '医疗',
    '教育',
    '制造',
    '物流',
    '房地产',
    '零售',
    '科技',
  ];

  const positions = [
    '通用',
    '客服',
    '运营',
    '销售',
    '数据分析',
    '内容创作',
    '技术支持',
    '人力资源',
    '财务',
    '行政',
  ];

  const models = [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-opus', label: 'Claude 3 Opus' },
  ];

  const handleSubmit = async (submitForReview: boolean) => {
    if (!formData.name.trim()) {
      toast.error('请输入员工名称');
      return;
    }

    if (selectedCapabilities.length === 0) {
      toast.error('请至少选择一个能力');
      return;
    }

    try {
      setIsSubmitting(true);
      const employee = await adminApi.createEmployee(formData);

      // Bind capabilities
      await bindCapabilitiesMutation.mutateAsync({
        employeeId: employee.id,
        capabilityIds: selectedCapabilities,
      });

      if (submitForReview) {
        await adminApi.submitEmployeeForReview(employee.id);
        toast.success('员工创建并提交审核成功');
      } else {
        toast.success('员工草稿保存成功');
      }

      router.push('/admin/employees');
    } catch (error: any) {
      toast.error(error.message || '操作失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-4xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回
        </Button>
        <h1 className="text-3xl font-bold">新建员工</h1>
        <p className="text-muted-foreground mt-2">
          创建一个新的硅基员工模板
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">员工名称 *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="例如：智能客服助手"
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">描述</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="简要描述该员工的功能和用途"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="industry">行业</Label>
              <Select
                value={formData.industry}
                onValueChange={(value) => setFormData({ ...formData, industry: value })}
              >
                <SelectTrigger id="industry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {industries.map((industry) => (
                    <SelectItem key={industry} value={industry}>
                      {industry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="position">岗位</Label>
              <Select
                value={formData.position}
                onValueChange={(value) => setFormData({ ...formData, position: value })}
              >
                <SelectTrigger id="position">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {positions.map((position) => (
                    <SelectItem key={position} value={position}>
                      {position}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="avatar">头像 URL</Label>
            <Input
              id="avatar"
              type="url"
              value={formData.avatar}
              onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
              placeholder="https://example.com/avatar.png"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="systemPrompt">系统提示词</Label>
            <Textarea
              id="systemPrompt"
              value={formData.systemPrompt}
              onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
              placeholder="定义该员工的人设和行为规范"
              rows={6}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="modelId">模型</Label>
              <Select
                value={formData.modelId}
                onValueChange={(value) => setFormData({ ...formData, modelId: value })}
              >
                <SelectTrigger id="modelId">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxSteps">最大步数</Label>
              <Input
                id="maxSteps"
                type="number"
                min={1}
                max={50}
                value={formData.maxSteps}
                onChange={(e) =>
                  setFormData({ ...formData, maxSteps: parseInt(e.target.value) || 10 })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">价格（元/月）</Label>
            <Input
              id="price"
              type="number"
              min={0}
              step={0.01}
              value={formData.price}
              onChange={(e) =>
                setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })
              }
              placeholder="0.00"
            />
          </div>

          <div className="space-y-4 pt-4 border-t">
            <div>
              <Label>绑定能力 *</Label>
              <p className="text-sm text-muted-foreground mb-3">
                选择此员工可以使用的能力（至少选择一个）
              </p>
            </div>

            <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                💡 <strong>提示：</strong>选择的能力会按顺序设置优先级，可以在「高级管理」中调整。
              </p>
            </div>

            {capabilitiesLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                加载能力列表...
              </div>
            ) : !capabilities || capabilities.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>暂无可用能力</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {capabilities.map((cap: any) => (
                  <label
                    key={cap.id}
                    className={cn(
                      'flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors',
                      selectedCapabilities.includes(cap.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedCapabilities.includes(cap.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCapabilities([...selectedCapabilities, cap.id]);
                        } else {
                          setSelectedCapabilities(
                            selectedCapabilities.filter((id) => id !== cap.id)
                          );
                        }
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{cap.name}</p>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {cap.description}
                      </p>
                      <Badge className="mt-2 bg-secondary text-secondary-foreground">
                        {cap.type}
                      </Badge>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {selectedCapabilities.length === 0 && (
              <p className="text-sm text-gdanger">* 请至少选择一个能力</p>
            )}
          </div>

          <div className="flex gap-4 pt-4">
            <Button
              onClick={() => handleSubmit(false)}
              disabled={isSubmitting}
              variant="secondary"
              className="flex-1"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              保存为草稿
            </Button>
            <Button
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              创建并提交审核
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
