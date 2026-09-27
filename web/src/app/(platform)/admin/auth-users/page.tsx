'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, ShieldCheck, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CenteredSpinner, EmptyState } from '@/components/ui/feedback';
import { useAdminAuthUsers } from '@/features/admin/use-admin-auth';

export default function AdminAuthUsersPage() {
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const users = useAdminAuthUsers({ keyword: query, status, pageSize: 50 });

  if (users.isLoading) return <CenteredSpinner />;
  if (users.isError) return <EmptyState title="认证用户加载失败" description="请稍后重试或检查管理员会话。" />;
  const data = users.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-muted">平台管理 / 认证中心</p>
          <h1 className="mt-1 text-2xl font-semibold">认证用户</h1>
          <p className="mt-1 text-sm text-fg-muted">查看认证状态、第三方身份、有效会话和安全事件。</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-muted"><ShieldCheck className="h-4 w-4" />仅平台管理员可操作</div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-muted" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQuery(keyword)} placeholder="搜索邮箱或姓名" className="pl-9" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-md border border-glassline bg-glass-1 px-3 text-sm">
            <option value="">全部状态</option><option value="ACTIVE">正常</option><option value="DISABLED">已禁用</option>
          </select>
          <Button variant="outline" onClick={() => setQuery(keyword)}>搜索</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>用户列表（{data?.total ?? 0}）</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {!data?.items.length ? <EmptyState title="暂无用户" description="没有符合条件的认证用户。" /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-glassline text-left text-fg-muted"><th className="p-4">用户</th><th className="p-4">状态</th><th className="p-4">登录方式</th><th className="p-4">邮箱</th><th className="p-4">创建时间</th><th className="p-4 text-right">操作</th></tr></thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id} className="border-b border-glassline/60 last:border-0">
                    <td className="p-4"><Link href={`/admin/auth-users/${user.id}`} className="flex items-center gap-3 hover:text-primary"><UserRound className="h-4 w-4 text-fg-muted" /><span><span className="block font-medium">{user.name || '未命名用户'}</span><span className="text-xs text-fg-muted">{user.id}</span></span></Link></td>
                    <td className="p-4">{user.status === 'DISABLED' ? <Badge variant="glass-danger">已禁用</Badge> : <Badge>正常</Badge>}</td>
                    <td className="p-4 text-fg-muted">密码 {user.identityCount > 0 ? `· 第三方 ${user.identityCount}` : ''}</td>
                    <td className="p-4">{user.email}</td>
                    <td className="p-4 text-fg-muted">{new Date(user.createdAt).toLocaleString('zh-CN')}</td>
                    <td className="p-4 text-right"><Link href={`/admin/auth-users/${user.id}`}><Button size="sm" variant="outline">查看</Button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
