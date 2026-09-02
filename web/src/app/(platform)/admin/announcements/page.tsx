'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import {
  useAnnouncements,
  useCreateAnnouncement,
  useUpdateAnnouncement,
  useDeleteAnnouncement,
  useTogglePublish,
  type Announcement,
  type CreateAnnouncementDto,
} from '@/features/announcement/use-announcements';

const announcementSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(100, '标题不能超过100字符'),
  content: z.string().min(1, '内容不能为空'),
  type: z.enum(['INFO', 'WARNING', 'ERROR', 'SUCCESS']),
  priority: z.coerce.number().int().min(0).max(100).default(0),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  published: z.boolean().default(false),
});

type AnnouncementFormValues = z.infer<typeof announcementSchema>;

const typeLabels = {
  INFO: '信息',
  WARNING: '警告',
  ERROR: '错误',
  SUCCESS: '成功',
};

// 公告类型的圆点颜色。用语义令牌而不是 bg-blue-500 这类字面色 ——
// 后者不跟随主题，深浅两套主题下的对比度不受控。
const typeColors = {
  INFO: 'bg-info',
  WARNING: 'bg-warning',
  ERROR: 'bg-danger',
  SUCCESS: 'bg-success',
};

export default function AnnouncementsPage() {
  const [page, setPage] = useState(1);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);

  const { data, isLoading } = useAnnouncements(page, 20);
  const createMutation = useCreateAnnouncement();
  const updateMutation = useUpdateAnnouncement();
  const deleteMutation = useDeleteAnnouncement();
  const togglePublishMutation = useTogglePublish();

  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: '',
      content: '',
      type: 'INFO',
      priority: 0,
      startTime: '',
      endTime: '',
      published: false,
    },
  });

  const onSubmit = async (values: AnnouncementFormValues) => {
    try {
      const payload: CreateAnnouncementDto = {
        ...values,
        startTime: values.startTime && values.startTime.trim() !== ''
          ? values.startTime
          : undefined,
        endTime: values.endTime && values.endTime.trim() !== ''
          ? values.endTime
          : undefined,
      };

      if (editingAnnouncement) {
        await updateMutation.mutateAsync({
          id: editingAnnouncement.id,
          data: payload,
        });
      } else {
        await createMutation.mutateAsync(payload);
      }

      form.reset();
      setIsCreateDialogOpen(false);
      setEditingAnnouncement(null);
    } catch (error) {
      console.error('Failed to save announcement:', error);
    }
  };

  const handleEdit = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    form.reset({
      title: announcement.title,
      content: announcement.content,
      type: announcement.type,
      priority: announcement.priority,
      startTime: announcement.startTime
        ? format(new Date(announcement.startTime), "yyyy-MM-dd'T'HH:mm")
        : '',
      endTime: announcement.endTime
        ? format(new Date(announcement.endTime), "yyyy-MM-dd'T'HH:mm")
        : '',
      published: announcement.published,
    });
    setIsCreateDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条公告吗？')) return;
    try {
      await deleteMutation.mutateAsync(id);
    } catch (error) {
      console.error('Failed to delete announcement:', error);
    }
  };

  const handleTogglePublish = async (id: string, currentStatus: boolean) => {
    try {
      await togglePublishMutation.mutateAsync({
        id,
        published: !currentStatus,
      });
    } catch (error) {
      console.error('Failed to toggle publish status:', error);
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      form.reset();
      setEditingAnnouncement(null);
    }
    setIsCreateDialogOpen(open);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">公告管理</h1>
          <p className="text-muted-foreground mt-1">创建和管理系统公告</p>
        </div>

        <Dialog open={isCreateDialogOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              创建公告
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingAnnouncement ? '编辑公告' : '创建新公告'}
              </DialogTitle>
              <DialogDescription>
                填写公告信息，设置显示时间和优先级
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>标题</FormLabel>
                      <FormControl>
                        <Input placeholder="请输入公告标题" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>内容</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="请输入公告内容"
                          className="min-h-[120px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>类型</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.entries(typeLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>优先级</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            placeholder="0-100"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>数值越大优先级越高</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>开始时间</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} />
                        </FormControl>
                        <FormDescription>留空表示立即生效</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="endTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>结束时间</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} />
                        </FormControl>
                        <FormDescription>留空表示永久有效</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="published"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">立即发布</FormLabel>
                        <FormDescription>
                          创建后立即发布到客户端显示
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleDialogClose(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {editingAnnouncement ? '保存' : '创建'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>公告列表</CardTitle>
          <CardDescription>
            共 {data?.total || 0} 条公告
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : !data?.data.length ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无公告，点击右上角创建第一条公告
            </div>
          ) : (
            <div className="space-y-4">
              {data.data.map((announcement) => (
                <div
                  key={announcement.id}
                  className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${typeColors[announcement.type]}`}
                      />
                      <h3 className="font-semibold">{announcement.title}</h3>
                      <Badge variant={announcement.published ? 'default' : 'glass'}>
                        {announcement.published ? '已发布' : '草稿'}
                      </Badge>
                      {announcement.priority > 0 && (
                        <Badge variant="glass">
                          优先级 {announcement.priority}
                        </Badge>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {announcement.content}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>创建时间: {format(new Date(announcement.createdAt), 'yyyy-MM-dd HH:mm')}</span>
                      {announcement.startTime && (
                        <span>开始: {format(new Date(announcement.startTime), 'yyyy-MM-dd HH:mm')}</span>
                      )}
                      {announcement.endTime && (
                        <span>结束: {format(new Date(announcement.endTime), 'yyyy-MM-dd HH:mm')}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        handleTogglePublish(announcement.id, announcement.published)
                      }
                      disabled={togglePublishMutation.isPending}
                    >
                      {announcement.published ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(announcement)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(announcement.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                第 {page} / {data.totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === data.totalPages}
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              >
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
