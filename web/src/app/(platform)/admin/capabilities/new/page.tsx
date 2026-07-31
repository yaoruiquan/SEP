'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminApi } from '@/features/admin/admin-api';
import { toast } from '@/components/ui/toast';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

const TYPE_LABELS = {
  AGENT: 'Agent（智能体）',
  SKILL: 'Skill（技能包）',
  RPA: 'RPA（流程自动化）',
  AI_APP: 'AI App',
};

const INDUSTRIES = ['电商', '跨境电商', '金融', '教育', '医疗', '通用'];
const POSITIONS = ['客服', '销售', '市场', '运营', '技术', '通用'];

export default function NewCapabilityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = (searchParams.get('type') || 'AGENT') as 'AGENT' | 'SKILL' | 'RPA' | 'AI_APP';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: type,
    industry: [] as string[],
    position: [] as string[],
    inputSchema: '{\n  "type": "object",\n  "properties": {\n    "input": {\n      "type": "string"\n    }\n  }\n}',
    outputSchema: '{\n  "type": "object",\n  "properties": {\n    "output": {\n      "type": "string"\n    }\n  }\n}',
  });

  const handleSubmit = async (action: 'draft' | 'submit') => {
    if (!formData.name.trim()) {
      toast.error('请输入能力名称');
      return;
    }

    setIsSubmitting(true);
    try {
      // 解析 JSON Schema
      const inputSchema = JSON.parse(formData.inputSchema);
      const outputSchema = JSON.parse(formData.outputSchema);

      // 创建能力
      const capability = await adminApi.createCapability({
        name: formData.name,
        description: formData.description,
        type: formData.type,
        industry: formData.industry,
        position: formData.position,
        inputSchema,
        outputSchema,
      });

      if (action === 'submit') {
        // 提交审核
        await adminApi.submitCapabilityForReview(capability.id);
        toast.success('能力已创建并提交审核');
      } else {
        toast.success('能力已保存为草稿');
      }

      router.push('/admin/capabilities');
    } catch (error: any) {
      if (error.message?.includes('JSON')) {
        toast.error('Schema 格式错误，请检查 JSON 格式');
      } else {
        toast.error(error.response?.data?.message || '创建失败');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/capabilities">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">新建能力 - {TYPE_LABELS[formData.type]}</h1>
          <p className="text-sm text-fg-muted mt-1">填写能力基本信息</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 能力名称 */}
          <div>
            <Label htmlFor="name">能力名称 *</Label>
            <Input
              id="name"
              placeholder="如：营销文案生成"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          {/* 描述 */}
          <div>
            <Label htmlFor="description">描述</Label>
            <Textarea
              id="description"
              placeholder="描述这个能力的功能和用途"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          {/* 行业 */}
          <div>
            <Label>适用行业</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {INDUSTRIES.map((ind) => (
                <label key={ind} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.industry.includes(ind)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData({ ...formData, industry: [...formData.industry, ind] });
                      } else {
                        setFormData({ ...formData, industry: formData.industry.filter((i) => i !== ind) });
                      }
                    }}
                  />
                  {ind}
                </label>
              ))}
            </div>
          </div>

          {/* 岗位 */}
          <div>
            <Label>适用岗位</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {POSITIONS.map((pos) => (
                <label key={pos} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.position.includes(pos)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData({ ...formData, position: [...formData.position, pos] });
                      } else {
                        setFormData({ ...formData, position: formData.position.filter((p) => p !== pos) });
                      }
                    }}
                  />
                  {pos}
                </label>
              ))}
            </div>
          </div>

          {/* Input Schema */}
          <div>
            <Label htmlFor="inputSchema">Input Schema（JSON）</Label>
            <Textarea
              id="inputSchema"
              className="font-mono text-sm"
              rows={6}
              value={formData.inputSchema}
              onChange={(e) => setFormData({ ...formData, inputSchema: e.target.value })}
            />
          </div>

          {/* Output Schema */}
          <div>
            <Label htmlFor="outputSchema">Output Schema（JSON）</Label>
            <Textarea
              id="outputSchema"
              className="font-mono text-sm"
              rows={6}
              value={formData.outputSchema}
              onChange={(e) => setFormData({ ...formData, outputSchema: e.target.value })}
            />
          </div>

          {/* 类型特定字段 */}
          {formData.type === 'AGENT' && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                💡 <strong>提示：</strong>Agent 类型需要上传代码包或关联 packageRef。
                当前可以先创建草稿，后续通过编辑页面上传代码。
              </p>
            </div>
          )}

          {formData.type === 'SKILL' && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                💡 <strong>提示：</strong>Skill 类型是纯函数，需要上传代码包。
                当前可以先创建草稿，后续通过编辑页面上传代码。
              </p>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
              取消
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSubmit('draft')}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              保存为草稿
            </Button>
            <Button onClick={() => handleSubmit('submit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              创建并提交审核
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
