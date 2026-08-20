'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Eye, Save, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { Markdown } from '@/features/chat/markdown';
import {
  useSkillVersionPreview,
  useSubmitEnterpriseSkillReview,
  useUpdateEnterpriseSkillVersion,
} from '@/features/skill-version/use-skill-version';

export default function SkillVersionEditPage() {
  const { versionId = '' } = useParams<{ versionId: string }>();
  const router = useRouter();
  const query = useSkillVersionPreview(versionId);
  const update = useUpdateEnterpriseSkillVersion();
  const submit = useSubmitEnterpriseSkillReview();
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setContent(query.data.content);
    setSummary(query.data.changeSummary ?? '');
  }, [query.data]);

  if (query.isLoading) return <CenteredSpinner label="加载技能版本..." />;
  if (!query.data) return <div className="p-6 text-sm text-gdanger">无法打开技能版本。</div>;

  const editable = query.data.status === 'DRAFT' || query.data.status === 'ENTERPRISE_REJECTED';
  const save = async () => {
    await update.mutateAsync({ id: versionId, content, changeSummary: summary });
    toast.success('草稿已保存');
  };
  const submitReview = async () => {
    await update.mutateAsync({ id: versionId, content, changeSummary: summary });
    await submit.mutateAsync(versionId);
    toast.success('已提交企业审核');
    router.push('/skills');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => router.push('/skills')} className="inline-flex items-center gap-2 text-sm text-gtext-secondary hover:text-gtext-primary">
          <ArrowLeft className="h-4 w-4" /> 返回技能管理
        </button>
        <div className="flex gap-2">
          <Button variant="glass" size="sm" onClick={() => setPreview((value) => !value)}>
            <Eye className="h-4 w-4" /> {preview ? '编辑正文' : '预览效果'}
          </Button>
          {editable && (
            <>
              <Button variant="glass" size="sm" loading={update.isPending} onClick={save}>
                <Save className="h-4 w-4" /> 保存草稿
              </Button>
              <Button variant="glass-primary" size="sm" loading={submit.isPending} onClick={submitReview}>
                <Send className="h-4 w-4" /> 提交审核
              </Button>
            </>
          )}
        </div>
      </div>
      <header>
        <h1 className="text-2xl font-semibold text-gtext-primary">{query.data.capability.name}</h1>
        <p className="mt-1 text-sm text-gtext-muted">企业版本 v{query.data.version}</p>
      </header>
      <Card className="p-5">
        <label className="mb-2 block text-sm font-medium text-gtext-secondary">变更说明</label>
        <Input value={summary} onChange={(event) => setSummary(event.target.value)} disabled={!editable} placeholder="说明这个版本解决了什么业务问题" />
      </Card>
      <Card className="min-h-[65vh] p-5">
        {preview ? (
          <div className="markdown-body mx-auto max-w-4xl"><Markdown content={content} /></div>
        ) : (
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={!editable}
            className="min-h-[60vh] resize-none font-mono text-sm leading-6"
          />
        )}
      </Card>
    </div>
  );
}
