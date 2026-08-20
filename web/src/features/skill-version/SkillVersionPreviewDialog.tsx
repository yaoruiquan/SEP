'use client';

import { useState } from 'react';
import { Check, Copy, FileCode2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Markdown } from '@/features/chat/markdown';
import { useSkillVersionPreview } from './use-skill-version';

export function SkillVersionPreviewDialog({
  versionId,
  open,
  onOpenChange,
  admin = false,
}: {
  versionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admin?: boolean;
}) {
  const query = useSkillVersionPreview(open ? versionId : '', admin);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('rendered');

  const copy = async () => {
    if (!query.data?.content) return;
    await navigator.clipboard.writeText(query.data.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent glass className="h-[86vh] max-w-5xl grid-rows-[auto_1fr] overflow-hidden p-0">
        <DialogHeader className="border-b border-glassline px-6 py-5 pr-14">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-gtext-primary">
                {query.data?.capability.name ?? '技能内容'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-gtext-muted">
                {query.data ? `版本 ${query.data.version} · ${query.data.scope === 'PLATFORM' ? '平台版本' : '企业版本'}` : '正在加载版本内容'}
              </DialogDescription>
            </div>
            <Button variant="glass" size="sm" onClick={copy} disabled={!query.data}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 overflow-hidden px-6 pb-6">
          {query.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gtext-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载技能正文...
            </div>
          ) : query.isError ? (
            <div className="flex h-full items-center justify-center text-sm text-gdanger">
              无法读取技能正文，请确认员工授权或稍后重试。
            </div>
          ) : (
            <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col pt-4">
              <TabsList className="w-fit bg-glass-1">
                <TabsTrigger value="rendered">渲染视图</TabsTrigger>
                <TabsTrigger value="source">
                  <FileCode2 className="h-4 w-4" /> Markdown
                </TabsTrigger>
              </TabsList>
              <TabsContent value="rendered" className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border border-glassline bg-glass-1 p-5 scroll-thin">
                <Markdown content={query.data?.content ?? ''} />
              </TabsContent>
              <TabsContent value="source" className="mt-3 min-h-0 flex-1 overflow-hidden">
                <pre className="h-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-glassline bg-glass-1 p-5 font-mono text-xs leading-6 text-gtext-secondary scroll-thin">
                  {query.data?.content}
                </pre>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
