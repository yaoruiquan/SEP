'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
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
import { adminApi, type EmployeeDetail } from '@/features/admin/admin-api';
import {
  useAvailableCapabilities,
  useEmployeeBindings,
  useBindCapabilities,
} from '@/features/admin/use-admin';
import { useEnabledModels } from '@/features/admin/use-models';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EditEmployeePage() {
  const router = useRouter();
  const params = useParams();
  const employeeId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    industry: '通用',
    position: '通用',
    avatar: '',
    systemPrompt: '',
    modelId: 'gpt-4o',
    annualPriceCNY: 0,
    includedComputeCNY: 0,
  });

  const { data: capabilities, isLoading: capabilitiesLoading } =
    useAvailableCapabilities();
  const { data: bindings } = useEmployeeBindings(employeeId);
  const { data: enabledModels, isLoading: modelsLoading } = useEnabledModels();
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

  useEffect(() => {
    loadEmployee();
  }, [employeeId]);

  useEffect(() => {
    if (bindings) {
      const ids = bindings.map((b: any) => b.capability.id);
      setSelectedCapabilities(ids);
    }
  }, [bindings]);

  const loadEmployee = async () => {
    try {
      setIsLoading(true);
      const data = await adminApi.getEmployeeDetail(employeeId);
      setEmployee(data);
      setFormData({
        name: data.name,
        description: data.description,
        industry: data.industry,
        position: data.position,
        avatar: data.avatar || '',
        systemPrompt: data.systemPrompt,
        modelId: data.modelId,
        annualPriceCNY: data.annualPriceCNY ? Number(data.annualPriceCNY) : 0,
        includedComputeCNY: data.includedComputeCNY ? Number(data.includedComputeCNY) : 0,
      });
    } catch (error: any) {
      toast.error(error.message || '加载员工信息失败');
      router.push('/admin/employees');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
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
      await adminApi.updateEmployee(employeeId, formData);
      await bindCapabilitiesMutation.mutateAsync({
        employeeId,
        capabilityIds: selectedCapabilities,
      });
      toast.success('员工信息更新成功');
      router.push('/admin/employees');
    } catch (error: any) {
      toast.error(error.message || '更新失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 max-w-4xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

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
        <h1 className="text-3xl font-bold">编辑员工</h1>
        <p className="text-muted-foreground mt-2">
          编辑员工信息 - {employee?.name}
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

          <div className="space-y-2">
            <Label htmlFor="modelId">模型</Label>
            <Select
              value={formData.modelId}
              onValueChange={(value) => setFormData({ ...formData, modelId: value })}
              disabled={modelsLoading}
            >
              <SelectTrigger id="modelId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelsLoading ? (
                  <div className="p-2 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  </div>
                ) : !enabledModels || enabledModels.length === 0 ? (
                  <div className="p-2 text-center text-sm text-muted-foreground">
                    暂无可用模型
                  </div>
                ) : (
                  enabledModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="annualPriceCNY">年费（元）*</Label>
              <Input
                id="annualPriceCNY"
                type="number"
                min={0}
                step={0.01}
                value={formData.annualPriceCNY}
                onChange={(e) =>
                  setFormData({ ...formData, annualPriceCNY: parseFloat(e.target.value) || 0 })
                }
                placeholder="5000"
              />
              <p className="text-xs text-muted-foreground">
                企业订阅此员工的年费
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="includedComputeCNY">赠送算力（元）*</Label>
              <Input
                id="includedComputeCNY"
                type="number"
                min={0}
                step={0.01}
                value={formData.includedComputeCNY}
                onChange={(e) =>
                  setFormData({ ...formData, includedComputeCNY: parseFloat(e.target.value) || 0 })
                }
                placeholder="1000"
              />
              <p className="text-xs text-muted-foreground">
                订阅后赠送的初始算力额度
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t">
            <div>
              <Label>绑定能力 *</Label>
              <p className="text-sm text-muted-foreground mb-3">
                选择此员工可以使用的能力（至少选择一个）
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
              onClick={() => router.back()}
              disabled={isSubmitting}
              variant="secondary"
              className="flex-1"
            >
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              保存更新
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
