'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { authAccessor } from '@/lib/auth-store';

function humanizeAction(action: string) {
  const path = action.replace(/^(POST|PUT|PATCH|DELETE)\s+/, '');
  const method = action.match(/^(POST|PUT|PATCH|DELETE)/)?.[1];
  if (path.includes('/grants')) return method === 'DELETE' ? '撤销员工授权' : '授权员工使用';
  if (path.includes('/subscriptions')) return method === 'POST' ? '创建雇佣关系' : method === 'DELETE' ? '解除雇佣关系' : '更新雇佣关系';
  if (path.includes('/departments')) return method === 'POST' ? '创建部门' : method === 'DELETE' ? '删除部门' : '更新部门';
  if (path.includes('/members')) return method === 'POST' ? '添加企业成员' : method === 'DELETE' ? '移除企业成员' : '更新成员信息';
  if (path.includes('/capabilities')) return method === 'POST' ? '创建能力' : method === 'DELETE' ? '删除能力' : '更新能力';
  if (path.includes('/settings')) return '更新企业设置';
  if (path.includes('/roles')) return method === 'POST' ? '创建角色' : method === 'DELETE' ? '删除角色' : '更新角色权限';
  if (path.includes('/api-keys')) return method === 'POST' ? '创建 API 密钥' : '删除 API 密钥';
  return `${method === 'POST' ? '创建' : method === 'PUT' || method === 'PATCH' ? '更新' : method === 'DELETE' ? '删除' : '执行'}操作`;
}

function humanizeResource(resourceType: string, action: string) {
  if (action.includes('/grants')) return '员工授权';
  if (action.includes('/subscriptions')) return '雇佣关系';
  if (action.includes('/departments')) return '部门';
  if (action.includes('/members')) return '企业成员';
  if (action.includes('/capabilities')) return '硅基能力';
  if (resourceType === 'enterprise') return '企业设置';
  if (resourceType.includes('grant')) return '员工授权';
  if (resourceType.includes('subscription')) return '雇佣关系';
  if (resourceType.includes('department')) return '部门';
  if (resourceType.includes('member')) return '企业成员';
  if (resourceType.includes('capabilit')) return '硅基能力';
  if (resourceType.includes('role')) return '角色权限';
  if (resourceType.includes('api')) return 'API 密钥';
  return action.split('/')[2] || resourceType || '系统资源';
}

export default function AuditPage() {
  const query = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => api.get<{ items: Array<any>; total: number }>('/audit-logs?pageSize=50'),
  });

  const exportCsv = async () => {
    const token = authAccessor.getToken();
    const response = await fetch('/api/audit-logs/export', {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'audit-logs.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">安全与审计</h1>
          <p className="mt-1 text-sm text-gtext-secondary">本企业近 90 天写操作记录</p>
        </div>
        <Button variant="glass" onClick={exportCsv}>
          <Download className="mr-2 h-4 w-4" />
          导出 CSV
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            操作日志 {query.data ? `（${query.data.total}）` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p>加载中...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2">时间</th>
                    <th className="p-2">操作人</th>
                    <th className="p-2">操作</th>
                    <th className="p-2">资源</th>
                    <th className="p-2">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {(query.data?.items ?? []).map((item) => (
                    <tr key={item.id} className="border-b border-glassline">
                      <td className="p-2">{new Date(item.createdAt).toLocaleString('zh-CN')}</td>
                      <td className="p-2">{item.actor?.name || item.actor?.email || item.actorId}</td>
                      <td className="p-2" title={item.action}>{humanizeAction(item.action)}</td>
                      <td className="p-2" title={`${item.resourceType}${item.resourceId ? `/${item.resourceId}` : ''}`}>
                        {humanizeResource(item.resourceType, item.action)}
                        {item.resourceId ? <span className="ml-1 text-xs text-gtext-muted">#{item.resourceId.slice(-8)}</span> : null}
                      </td>
                      <td className="p-2">{item.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
