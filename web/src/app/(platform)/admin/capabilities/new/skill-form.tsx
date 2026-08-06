'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { Loader2, Upload, File, CheckCircle, XCircle } from 'lucide-react';
import { adminApi } from '@/features/admin/admin-api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const INDUSTRIES = ['电商', '跨境电商', '金融', '教育', '医疗', '通用'];
const POSITIONS = ['客服', '销售', '市场', '运营', '技术', '通用'];

const skillFormSchema = z.object({
  name: z.string().min(1, '能力名称不能为空'),
  description: z.string().min(10, '描述至少 10 个字符'),
  industry: z.array(z.string()),
  position: z.array(z.string()),
});

type SkillFormValues = z.infer<typeof skillFormSchema>;

type UploadMetadata = {
  zipPath: string;
  sha256: string;
  fileCount: number;
  totalSize: number;
  filename: string;
};

export function SkillForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [uploadMetadata, setUploadMetadata] = useState<UploadMetadata | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: { name: '', description: '', industry: [], position: [] },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SkillFormValues & { zipPath: string; sha256: string; fileCount: number; totalSize: number }) => {
      const res = await fetch('/api/admin/capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'SKILL',
          name: data.name,
          description: data.description,
          industry: data.industry,
          position: data.position,
          zipPath: data.zipPath,
          sha256: data.sha256,
          fileCount: data.fileCount,
          totalSize: data.totalSize,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || '创建失败');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('创建成功', 'SKILL 能力已创建');
      qc.invalidateQueries({ queryKey: ['capabilities'] });
      router.push('/admin/capabilities');
    },
    onError: (err: any) => {
      toast.error('创建失败', err.message);
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.zip')) {
      setUploadError('只支持 .zip 文件');
      setFile(null);
      setUploadMetadata(null);
      return;
    }

    setFile(selectedFile);
    setUploadError(null);
    setUploadMetadata(null);

    // 自动上传
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/admin/capabilities/upload-skill', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || '上传失败');
      }

      const metadata: UploadMetadata = await res.json();
      setUploadMetadata(metadata);
      toast.success('上传成功', `已验证 SKILL.md，文件数: ${metadata.fileCount}`);
    } catch (err: any) {
      setUploadError(err.message);
      setFile(null);
      toast.error('上传失败', err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const onSubmit = (data: SkillFormValues) => {
    if (!uploadMetadata) {
      toast.error('请先上传 zip 文件');
      return;
    }
    createMutation.mutate({
      ...data,
      zipPath: uploadMetadata.zipPath,
      sha256: uploadMetadata.sha256,
      fileCount: uploadMetadata.fileCount,
      totalSize: uploadMetadata.totalSize,
    });
  };

  const selectedIndustry = watch('industry') || [];
  const selectedPosition = watch('position') || [];

  const toggleIndustry = (ind: string) => {
    const current = selectedIndustry.includes(ind);
    setValue('industry', current ? selectedIndustry.filter((i) => i !== ind) : [...selectedIndustry, ind]);
  };

  const togglePosition = (pos: string) => {
    const current = selectedPosition.includes(pos);
    setValue('position', current ? selectedPosition.filter((p) => p !== pos) : [...selectedPosition, pos]);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>2. 上传 SKILL.md 包</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">Zip 文件（必须包含 SKILL.md）</Label>
            <div className="flex items-center gap-3">
              <Input
                id="file"
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                disabled={isUploading}
                className="flex-1"
              />
              {isUploading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              {uploadMetadata && <CheckCircle className="h-5 w-5 text-green-600" />}
              {uploadError && <XCircle className="h-5 w-5 text-red-600" />}
            </div>
            {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
            {uploadMetadata && (
              <div className="text-sm text-muted-foreground space-y-1 bg-muted/30 p-3 rounded">
                <p>✅ 文件: {uploadMetadata.filename}</p>
                <p>✅ 文件数: {uploadMetadata.fileCount}</p>
                <p>✅ 大小: {(uploadMetadata.totalSize / 1024).toFixed(2)} KB</p>
                <p>✅ SHA256: {uploadMetadata.sha256.slice(0, 16)}...</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. 能力信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">能力名称</Label>
            <Input id="name" placeholder="例如：前端代码生成助手" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">能力描述</Label>
            <Textarea
              id="description"
              placeholder="详细描述该 SKILL 的功能和用途"
              rows={4}
              {...register('description')}
            />
            {errors.description && <p className="text-sm text-red-600">{errors.description.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>适用行业（可多选）</Label>
            <div className="flex flex-wrap gap-2">
              {INDUSTRIES.map((ind) => (
                <button
                  key={ind}
                  type="button"
                  onClick={() => toggleIndustry(ind)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    selectedIndustry.includes(ind)
                      ? 'bg-primary text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {ind}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>适用岗位（可多选）</Label>
            <div className="flex flex-wrap gap-2">
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => togglePosition(pos)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    selectedPosition.includes(pos)
                      ? 'bg-primary text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          取消
        </Button>
        <Button type="submit" disabled={isSubmitting || !uploadMetadata}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          创建能力
        </Button>
      </div>
    </form>
  );
}
