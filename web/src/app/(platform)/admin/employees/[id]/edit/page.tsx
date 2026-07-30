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
import { adminApi, type EmployeeDetail } from '@/features/admin/admin-api';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function EditEmployeePage() {
  const router = useRouter();
  const params = useParams();
  const employeeId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    industry: '通用',
    position: '通用',
    avatar: '',
    systemPrompt: '',
    modelId: 'gpt-4o',
    maxSteps: 10,
    price: 0,
  });

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

  useEffect(() => {
    loadEmployee();
  }, [employeeId]);

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
        maxSteps: data.maxSteps,
        price: data.price || 0,
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

    try {
      setIsSubmitting(true);
      await adminApi.updateEmployee(employeeId, formData);
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
