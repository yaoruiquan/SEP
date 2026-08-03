'use client';

import { useState, useMemo } from 'react';
import { Clock, CheckCircle, XCircle, PlayCircle, Plus, Wifi, WifiOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, CenteredSpinner } from '@/components/ui/feedback';
import { LaunchTaskDialog } from '@/features/task/launch-task-dialog';
import { TaskExecutionPanel } from '@/features/task/task-execution-panel';
import { TaskListSkeleton } from '@/features/task/task-skeleton';
import { useChatStream } from '@/features/chat/use-chat-stream';
import { useConversations, useCreateConversation } from '@/features/chat/use-conversations';
import { useAuthStore } from '@/lib/auth-store';
import { useTaskUpdates } from '@/hooks/use-realtime';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  employee: { id: string; name: string; avatar: string | null };
  initiator: { name: string; avatar: string | null };
  createdAt: string;
  completedAt?: string;
  duration?: number;
  tokens?: number;
  progress?: number;
  conversationId?: string;
  messageCount?: number;
}

interface RunningTask {
  conversationId: string;
  status: 'running' | 'failed';
  startedAt: string;
  tokens?: number;
}

const STATUS_CONFIGS: Record<TaskStatus, { label: string; dotColor: string; icon: React.ReactNode }> = {
  pending:   { label: '待执行', dotColor: 'bg-gray-400',  icon: <Clock className="h-3.5 w-3.5" /> },
  running:   { label: '执行中', dotColor: 'bg-blue-500',  icon: <PlayCircle className="h-3.5 w-3.5" /> },
  completed: { label: '已完成', dotColor: 'bg-green-500', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  failed:    { label: '失败',   dotColor: 'bg-red-500',   icon: <XCircle className="h-3.5 w-3.5" /> },
};

function TaskCard({
  task,
  onViewLive,
}: {
  task: Task;
  onViewLive: (task: Task) => void;
}) {
  const config = STATUS_CONFIGS[task.status];

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-medium text-base truncate">{task.title}</h3>
            <Badge className={`flex items-center gap-1 shrink-0 text-white text-xs ${config.dotColor}`}>
              {config.icon}
              {config.label}
            </Badge>
          </div>

          <div className="flex items-center gap-4 text-sm text-fg-muted mb-2">
            <div className="flex items-center gap-1.5">
              <Avatar name={task.employee.name} className="h-5 w-5 text-xs" />
              <span>{task.employee.name}</span>
            </div>
            <span className="text-fg-subtle">•</span>
            <div className="flex items-center gap-1.5">
              <Avatar name={task.initiator.name} className="h-5 w-5 text-xs" />
              <span>{task.initiator.name} 发起</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-fg-subtle">
            <span>
              {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true, locale: zhCN })}
            </span>
            {task.status === 'running' && task.progress != null && (
              <>
                <span>•</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-bg-subtle rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${task.progress}%` }} />
                  </div>
                  <span>{task.progress}%</span>
                </div>
              </>
            )}
            {task.status === 'completed' && task.duration != null && (
              <>
                <span>•</span>
                <span>耗时 {task.duration}s</span>
                {task.tokens != null && (
                  <>
                    <span>•</span>
                    <span>{task.tokens.toLocaleString()} tokens</span>
                  </>
                )}
              </>
            )}
            {task.status === 'completed' && task.messageCount != null && (
              <>
                <span>•</span>
                <span>{task.messageCount} 条消息</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {task.status === 'running' && (
            <>
              <Button size="sm" variant="outline" onClick={() => onViewLive(task)}>
                查看实时
              </Button>
              <Button size="sm" variant="ghost">终止</Button>
            </>
          )}
          {task.status === 'completed' && (
            <>
              <Button size="sm" variant="outline" onClick={() => onViewLive(task)}>
                查看结果
              </Button>
              <Button size="sm" variant="ghost">重新执行</Button>
            </>
          )}
          {task.status === 'failed' && (
            <>
              <Button size="sm" variant="outline" onClick={() => onViewLive(task)}>
                查看详情
              </Button>
              <Button size="sm" variant="ghost">重试</Button>
            </>
          )}
          {task.status === 'pending' && (
            <Button size="sm" variant="ghost">取消</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState<'all' | TaskStatus>('all');

  // Fetch conversations (task history)
  const { data: conversations = [], isLoading, isError, error } = useConversations();
  const { user } = useAuthStore();

  // WebSocket 实时更新
  const { isConnected: wsConnected, reconnectCount } = useTaskUpdates();

  // Track tasks currently running (not yet in API)
  const [runningTasks, setRunningTasks] = useState<Map<string, RunningTask>>(new Map());

  // Modal state
  const [launchOpen, setLaunchOpen] = useState(false);

  // Execution panel state
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // SSE stream hook
  const { state: stream, send, stop, reset } = useChatStream();

  // Create conversation (our "task" runs inside a conversation)
  const createConv = useCreateConversation();

  // Merge API conversations + local running tasks into unified Task[]
  const tasks = useMemo<Task[]>(() => {
    const result: Task[] = [];

    // Convert API conversations to tasks
    conversations.forEach((conv) => {
      const running = runningTasks.get(conv.id);

      if (running) {
        // Task is currently running
        result.push({
          id: conv.id,
          title: conv.title || '未命名任务',
          status: running.status,
          employee: {
            id: conv.employee?.id || conv.employeeId,
            name: conv.employee?.name || '执行员工',
            avatar: conv.employee?.avatar || null,
          },
          initiator: { name: user?.name || '我', avatar: null },
          createdAt: conv.createdAt,
          conversationId: conv.id,
          tokens: running.tokens,
        });
      } else {
        // Historical task (completed)
        result.push({
          id: conv.id,
          title: conv.title || '未命名任务',
          status: 'completed',
          employee: {
            id: conv.employee?.id || conv.employeeId,
            name: conv.employee?.name || '执行员工',
            avatar: conv.employee?.avatar || null,
          },
          initiator: { name: user?.name || '我', avatar: null },
          createdAt: conv.createdAt,
          completedAt: conv.updatedAt,
          conversationId: conv.id,
          messageCount: conv._count?.messages,
        });
      }
    });

    // Add local running tasks not yet in API
    runningTasks.forEach((task, convId) => {
      if (!conversations.find((c) => c.id === convId)) {
        result.push({
          id: convId,
          title: '任务执行中...',
          status: task.status,
          employee: { id: '', name: '执行员工', avatar: null },
          initiator: { name: user?.name || '我', avatar: null },
          createdAt: task.startedAt,
          conversationId: convId,
          tokens: task.tokens,
        });
      }
    });

    // Sort by creation time (newest first)
    return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [conversations, runningTasks, user]);

  const handleLaunch = (employeeId: string, content: string) => {
    createConv.mutate(
      { employeeId },
      {
        onSuccess: (conv) => {
          // Add to local running tasks
          setRunningTasks((prev) => {
            const next = new Map(prev);
            next.set(conv.id, {
              conversationId: conv.id,
              status: 'running',
              startedAt: new Date().toISOString(),
            });
            return next;
          });

          const newTask: Task = {
            id: conv.id,
            title: content.slice(0, 60) + (content.length > 60 ? '...' : ''),
            status: 'running',
            employee: { id: employeeId, name: '执行员工', avatar: null },
            initiator: { name: user?.name || '我', avatar: null },
            createdAt: new Date().toISOString(),
            conversationId: conv.id,
          };

          setActiveTask(newTask);
          setLaunchOpen(false);
          setPanelOpen(true);
          reset();

          // Start streaming
          send(conv.id, content, (done) => {
            // Remove from running tasks when complete
            setRunningTasks((prev) => {
              const next = new Map(prev);
              next.delete(conv.id);
              return next;
            });
          });
        },
      },
    );
  };

  const handleViewLive = (task: Task) => {
    setActiveTask(task);
    setPanelOpen(true);
  };

  const filteredTasks =
    activeTab === 'all' ? tasks : tasks.filter((t) => t.status === activeTab);

  const stats = {
    all:       tasks.length,
    running:   tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed:    tasks.filter((t) => t.status === 'failed').length,
  };

  return (
    <div className="flex h-full flex-col">
      {/* 页头 */}
      <div className="border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">任务中心</h1>
              {/* WebSocket 连接状态 */}
              <div className="flex items-center gap-1.5 text-xs">
                {wsConnected ? (
                  <>
                    <Wifi className="h-3.5 w-3.5 text-success" />
                    <span className="text-success">实时连接</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5 text-fg-muted" />
                    <span className="text-fg-muted">
                      {reconnectCount > 0 ? `重连中 (${reconnectCount})` : '离线'}
                    </span>
                  </>
                )}
              </div>
            </div>
            <p className="text-sm text-fg-muted mt-1">管理和追踪所有碳基员工任务</p>
          </div>
          <Button onClick={() => setLaunchOpen(true)}>
            <Plus className="h-4 w-4" />
            发起任务
          </Button>
        </div>
      </div>

      {/* Tab 筛选 */}
      <div className="border-b border-border bg-background px-6">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="bg-transparent h-auto gap-1 p-0 rounded-none">
            {(['all', 'running', 'completed', 'failed'] as const).map((tab) => {
              const labels: Record<string, string> = {
                all: '全部', running: '执行中', completed: '已完成', failed: '失败',
              };
              const count = tab === 'all' ? stats.all : stats[tab];
              return (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="rounded-none border-b-2 border-transparent data-[active=true]:border-primary"
                >
                  {labels[tab]}
                  <Badge className="ml-1.5 bg-muted text-fg-muted">{count}</Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <TaskListSkeleton count={5} />
        ) : isError ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="加载失败"
              description={error?.message || '无法加载任务列表，请稍后重试。'}
              action={
                <Button size="sm" onClick={() => window.location.reload()}>
                  刷新页面
                </Button>
              }
            />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              title="暂无任务"
              description={'点击右上角「发起任务」创建第一个任务'}
            />
          </div>
        ) : (
          <div className="space-y-3 max-w-5xl">
            {filteredTasks.map((task) => (
              <TaskCard key={task.id} task={task} onViewLive={handleViewLive} />
            ))}
          </div>
        )}
      </div>

      {/* 发起任务 Modal */}
      <LaunchTaskDialog
        open={launchOpen}
        creating={createConv.isPending}
        onClose={() => setLaunchOpen(false)}
        onCreate={handleLaunch}
      />

      {/* 执行详情面板 */}
      {activeTask && (
        <TaskExecutionPanel
          open={panelOpen}
          taskId={activeTask.id}
          taskTitle={activeTask.title}
          stream={stream}
          onClose={() => setPanelOpen(false)}
          onStop={() => {
            stop();
            setRunningTasks((prev) => {
              const next = new Map(prev);
              next.set(activeTask.id, {
                conversationId: activeTask.id,
                status: 'failed',
                startedAt: activeTask.createdAt,
              });
              return next;
            });
            setPanelOpen(false);
          }}
        />
      )}
    </div>
  );
}
