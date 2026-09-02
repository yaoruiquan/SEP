'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Eye, FileText, Save, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CenteredSpinner } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { Markdown } from '@/features/chat/markdown';
import { nav } from '@/locales/zh-CN';
import {
  usePublishEnterpriseSkillVersion,
  useSkillVersionPreview,
  useUpdateEnterpriseSkillVersion,
} from '@/features/skill-version/use-skill-version';

export default function SkillVersionEditPage() {
  const { versionId = '' } = useParams<{ versionId: string }>();
  const router = useRouter();
  const query = useSkillVersionPreview(versionId);
  const update = useUpdateEnterpriseSkillVersion();
  const publish = usePublishEnterpriseSkillVersion();
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
  const original = !query.data.parentVersionId && !query.data.sourceVersionId;
  const validateSummary = () => {
    if (!original && !summary.trim()) {
      toast.error('请填写本版本的变更说明');
      return false;
    }
    return true;
  };
  const save = async () => {
    if (!validateSummary()) return;
    await update.mutateAsync({ id: versionId, content, changeSummary: summary });
    toast.success('草稿已保存');
  };
  /**
   * 保存并发布。
   *
   * 会议纪要2 §6.4 否掉了企业内提审流 —— 这里原先是「提交企业审核」，
   * 而审批人就是点这个按钮的管理员自己。现在一步发布并对全部雇佣关系生效。
   */
  const saveAndPublish = async () => {
    if (!validateSummary()) return;
    await update.mutateAsync({ id: versionId, content, changeSummary: summary });
    const result = await publish.mutateAsync(versionId);
    toast.success('已发布并生效', `对 ${result.affectedSubscriptions} 个雇佣关系生效`);
    router.push('/capabilities');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => router.push('/capabilities')} className="inline-flex items-center gap-2 text-sm text-gtext-secondary hover:text-gtext-primary">
          <ArrowLeft className="h-4 w-4" /> 返回{nav.capabilities}
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
              <Button variant="glass-primary" size="sm" loading={publish.isPending} onClick={saveAndPublish}>
                <Send className="h-4 w-4" /> 发布并生效
              </Button>
            </>
          )}
        </div>
      </div>
      <header>
        <h1 className="text-2xl font-semibold text-gtext-primary">{query.data.capability.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gtext-muted">
          <span>企业版本 v{query.data.version}</span>
          {original && <Badge variant="glass-info"><FileText className="mr-1 h-3.5 w-3.5" />原始版本</Badge>}
          {query.data.parentVersionId && <span>基于父版本创建</span>}
        </div>
      </header>
      <Card className="p-5">
        <label className="mb-2 block text-sm font-medium text-gtext-secondary">变更说明 {!original && <span className="text-gdanger">*</span>}</label>
        <Input value={summary} onChange={(event) => setSummary(event.target.value)} disabled={!editable} placeholder={original ? '原始版本可填写初始化说明' : '说明这个版本改了什么、解决了什么问题'} />
        <p className="mt-2 text-xs text-gtext-muted">{original ? '这是技能的原始正文，后续版本会从此版本派生。' : '发布前必须填写 —— 版本时间线上就靠它说明这一版改了什么。'}</p>
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
