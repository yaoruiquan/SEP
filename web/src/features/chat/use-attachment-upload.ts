'use client';

import { useCallback, useRef, useState } from 'react';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentTypeOf,
  uploadAttachment,
  validateFile,
} from '@/lib/upload';
import type { AttachmentType, MessageAttachment } from '@/lib/types';

/**
 * 输入框里一个待发送的附件。
 *
 * 上传是在**选中文件时**立即开始的，不等用户点发送 —— 这样发送动作是纯
 * 粹的元数据提交，不会卡在几十兆的传输上。所以这里要同时表达三种状态：
 * 正在传（uploading）、传好了（有 attachment）、传失败了（有 error）。
 */
export interface PendingAttachment {
  /** 客户端本地 id，用于 React key 和删除定位 */
  id: string;
  name: string;
  size: number;
  type: AttachmentType | undefined;
  /** 图片本地预览地址（createObjectURL），非图片为 undefined */
  previewUrl?: string;
  status: 'uploading' | 'done' | 'error';
  /** status === 'done' 时有值，就是要发给后端的记录 */
  attachment?: MessageAttachment;
  error?: string;
}

let seq = 0;
const nextId = () => `att-${Date.now()}-${seq++}`;

export function useAttachmentUpload() {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  // 用 ref 镜像一份，供 addFiles 里做「加上这批会不会超数量上限」的判断 ——
  // 连续两次选择文件时 state 还没提交，只看闭包里的 items 会算少。
  const itemsRef = useRef<PendingAttachment[]>([]);
  const [limitError, setLimitError] = useState<string | null>(null);

  // itemsRef 是唯一事实源，setItems 只负责把它发布给渲染。
  // 不走 setItems(prev => …) 是因为那个 updater 的执行时机由 React 决定：
  // 上传 resolve 得比提交更早时，prev 里还没有那条 entry，map 会匹配不到 id
  // 而把状态更新静默丢掉。改成先动 ref 再发布，就与提交时机无关了。
  const commit = useCallback(
    (updater: (prev: PendingAttachment[]) => PendingAttachment[]) => {
      itemsRef.current = updater(itemsRef.current);
      setItems(itemsRef.current);
    },
    [],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setLimitError(null);

      const room = MAX_ATTACHMENTS_PER_MESSAGE - itemsRef.current.length;
      if (room <= 0) {
        setLimitError(`最多附加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个文件`);
        return;
      }
      const accepted = files.slice(0, room);
      if (files.length > room) {
        setLimitError(
          `最多附加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个文件，已忽略 ${files.length - room} 个`,
        );
      }

      const entries: PendingAttachment[] = accepted.map((file) => {
        const kind = attachmentTypeOf(file.name);
        const validationError = validateFile(file);
        return {
          id: nextId(),
          name: file.name,
          size: file.size,
          type: kind,
          previewUrl:
            kind === 'image' && !validationError
              ? URL.createObjectURL(file)
              : undefined,
          status: validationError ? 'error' : 'uploading',
          error: validationError ?? undefined,
        };
      });

      // 同步推进 —— 同一个 tick 里连续选两次文件时，上面的 room 判断必须
      // 看到已加进来的那批，否则会放进超过上限的附件。
      commit((prev) => [...prev, ...entries]);

      for (const [i, file] of accepted.entries()) {
        const { id, error: validationError } = entries[i];
        if (validationError) continue;

        // 逐个上传而非一次批量：某个文件失败时只标红它自己，
        // 其余照常可发送。
        void uploadAttachment(file)
          .then((attachment) => {
            commit((prev) =>
              prev.map((it) =>
                it.id === id ? { ...it, status: 'done', attachment } : it,
              ),
            );
          })
          .catch((err: unknown) => {
            commit((prev) =>
              prev.map((it) =>
                it.id === id
                  ? {
                      ...it,
                      status: 'error',
                      error: (err as Error)?.message || '上传失败',
                    }
                  : it,
              ),
            );
          });
      }
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      setLimitError(null);
      commit((prev) => {
        const target = prev.find((it) => it.id === id);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((it) => it.id !== id);
      });
    },
    [commit],
  );

  /**
   * 摘下当前所有附件并返回快照，**不吊销 previewUrl**。
   *
   * 发送流程要的是"先从输入框拿走，等确认发送成功再真正丢弃"：发送失败时
   * 用 restore 原样放回，用户不必重新上传（文件可能有几十兆）。预览地址
   * 一旦 revoke 就无法复活，所以吊销这一步留给 dispose。
   */
  const detach = useCallback((): PendingAttachment[] => {
    const snapshot = itemsRef.current;
    setLimitError(null);
    commit(() => []);
    return snapshot;
  }, [commit]);

  /** 把 detach 的快照放回输入框（发送失败时用） */
  const restore = useCallback(
    (snapshot: PendingAttachment[]) => {
      if (snapshot.length === 0) return;
      commit((prev) => [...snapshot, ...prev]);
    },
    [commit],
  );

  /** 真正释放快照占用的预览地址（确认不再需要还原后调用） */
  const dispose = useCallback((snapshot: PendingAttachment[]) => {
    for (const it of snapshot) {
      if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    }
  }, []);

  const clear = useCallback(() => {
    dispose(detach());
  }, [detach, dispose]);

  /** 已上传成功、可随消息发送的记录 */
  const ready = items
    .filter((it) => it.status === 'done' && it.attachment)
    .map((it) => it.attachment as MessageAttachment);

  return {
    items,
    ready,
    /** 还有文件在传 —— 此时应禁用发送，否则会漏附件 */
    uploading: items.some((it) => it.status === 'uploading'),
    limitError,
    addFiles,
    remove,
    clear,
    detach,
    restore,
    dispose,
  };
}
