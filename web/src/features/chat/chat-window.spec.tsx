import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatWindow } from './chat-window';
import { useAuthStore } from '@/lib/auth-store';
import type { Message, MessageAttachment } from '@/lib/types';

/**
 * ChatWindow 是装配层：它自己的逻辑只有三块 ——
 * 员工列表拼装（默认员工排首位 + 去重）、消息归属判定（handledBy → 员工）、
 * 发送时把 targetEmployeeId/attachments 透传下去并记住本轮流式作者。
 *
 * 所以数据源全部 mock，只留这三块真实跑；子组件里除 InputBar 外都替成轻量桩，
 * 避免 markdown/highlight.js 之类的重依赖拖慢测试。
 */

const sendSpy = vi.fn();
const stopSpy = vi.fn();
const resetSpy = vi.fn();

let conversationData: unknown = undefined;
let conversationLoading = false;
let subscribedData: unknown[] = [];
let streamState = {
  streaming: false,
  text: '',
  reasoning: '',
  toolCalls: [] as unknown[],
  error: null as string | null,
};

vi.mock('./use-conversations', () => ({
  useConversation: () => ({
    data: conversationData,
    isLoading: conversationLoading,
  }),
}));

vi.mock('./use-chat-stream', () => ({
  useChatStream: () => ({
    state: streamState,
    send: sendSpy,
    stop: stopSpy,
    reset: resetSpy,
  }),
}));

vi.mock('./use-subscribed-employees', () => ({
  useSubscribedEmployees: () => ({ data: subscribedData }),
}));

vi.mock('@/features/enterprise-settings/use-model-config', () => ({
  useModelConfig: () => ({ data: { allowedChatModels: [], allowUserSwitchModel: true } }),
}));

// 模型切换与本文件无关，且内部要发请求
vi.mock('./model-switcher', () => ({
  ModelSwitcher: () => <div data-testid="model-switcher" />,
}));

// 气泡替成桩：把 ChatWindow 传下来的归属信息原样暴露成 data 属性，
// 这样断言的是「谁被判定为作者」而不是气泡的渲染细节。
vi.mock('./message-bubble', () => ({
  MessageBubble: (props: {
    role: string;
    content: string;
    employeeName?: string;
    employeeAvatar?: string | null;
    attachments?: MessageAttachment[] | null;
    streaming?: boolean;
  }) => (
    <div
      data-testid="bubble"
      data-role={props.role}
      data-author={props.employeeName ?? ''}
      data-avatar={props.employeeAvatar ?? ''}
      data-attachments={props.attachments?.length ?? 0}
      data-streaming={props.streaming ? '1' : '0'}
    >
      {props.content}
    </div>
  ),
}));

// InputBar 用真实组件太重（含上传 hook），替成能触发 onSend 的桩，
// 并把它收到的 employees / defaultEmployeeId 暴露出来供断言。
vi.mock('./input-bar', () => ({
  InputBar: (props: {
    onSend: (
      text: string,
      targetEmployeeId?: string,
      attachments?: MessageAttachment[],
    ) => void;
    defaultEmployeeId: string;
    employees?: { id: string; name: string; position?: string }[];
  }) => (
    <div
      data-testid="input-bar"
      data-default={props.defaultEmployeeId}
      data-employees={JSON.stringify(
        props.employees?.map((e) => ({ id: e.id, name: e.name, position: e.position })) ?? [],
      )}
    >
      <button
        data-testid="send-default"
        onClick={() => props.onSend('你好')}
      />
      <button
        data-testid="send-to-e2"
        onClick={() => props.onSend('给小博', 'e2')}
      />
      <button
        data-testid="send-with-file"
        onClick={() =>
          props.onSend('看图', 'e2', [
            {
              type: 'image',
              key: 'k1',
              url: 'https://x/1.png',
              name: '1.png',
              size: 10,
            },
          ])
        }
      />
    </div>
  ),
}));

const EMPLOYEE = {
  id: 'e1',
  name: '小艾',
  avatar: 'https://cdn/a.png',
  modelId: 'm1',
};

function message(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'ASSISTANT',
    content: '回复内容',
    createdAt: '2026-08-13T00:00:00Z',
    ...over,
  };
}

function renderWindow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatWindow conversationId="c1" />
    </QueryClientProvider>,
  );
}

const bubbles = () => screen.getAllByTestId('bubble');
const inputBar = () => screen.getByTestId('input-bar');
const employeesPassedToInput = () =>
  JSON.parse(inputBar().getAttribute('data-employees') ?? '[]');

/**
 * 让 sendSpy 表现得像真的收完了流：调用方传进来的 onDone（第 4 个参数）
 * 会被立刻触发，带上后端 done 事件里的 messageId。
 */
function sendResolvesWith(messageId?: string) {
  sendSpy.mockImplementation(
    async (
      _convId: string,
      _text: string,
      _target: string | undefined,
      onDone?: (info: { messageId?: string; toolCalls: unknown[] }) => void,
    ) => {
      await onDone?.({ messageId, toolCalls: [] });
      return 'ok';
    },
  );
}

describe('ChatWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendSpy.mockResolvedValue('ok');
    conversationLoading = false;
    subscribedData = [];
    streamState = {
      streaming: false,
      text: '',
      reasoning: '',
      toolCalls: [],
      error: null,
    };
    conversationData = {
      id: 'c1',
      title: '测试会话',
      modelId: 'm1',
      employee: EMPLOYEE,
      messages: [],
    };
    useAuthStore.setState({
      token: 't',
      user: { id: 'u1', email: 'a@b.c', name: '测试', role: 'USER' },
      enterprise: { id: 'ent1', name: '示例科技' },
      roleInEnterprise: 'MEMBER',
      hydrated: true,
    });
  });

  describe('加载与空态', () => {
    it('加载中显示骨架文案', () => {
      conversationLoading = true;
      renderWindow();
      expect(screen.getByText('加载会话…')).toBeInTheDocument();
    });

    it('无消息时显示引导空态，带员工名', () => {
      renderWindow();
      expect(screen.getByText('开始和 小艾 对话')).toBeInTheDocument();
    });

    it('会话未加载出员工时空态用兜底称呼', () => {
      conversationData = { id: 'c1', messages: [], employee: undefined };
      renderWindow();
      expect(screen.getByText('开始和 碳基员工 对话')).toBeInTheDocument();
    });
  });

  describe('员工列表拼装', () => {
    it('只有会话员工时列表仅一项', () => {
      renderWindow();
      expect(employeesPassedToInput()).toEqual([
        { id: 'e1', name: '小艾', position: undefined },
      ]);
      expect(inputBar()).toHaveAttribute('data-default', 'e1');
    });

    it('会话默认员工排首位，其余订阅员工跟随其后', () => {
      subscribedData = [
        { id: 'e2', name: '小博', avatar: null, position: '文案' },
        { id: 'e3', name: '小卡', avatar: null, position: '设计' },
      ];
      renderWindow();

      expect(employeesPassedToInput().map((e: { id: string }) => e.id)).toEqual([
        'e1',
        'e2',
        'e3',
      ]);
    });

    it('默认员工也在订阅列表里时不重复出现，并补上其职位', () => {
      subscribedData = [
        { id: 'e2', name: '小博', avatar: null, position: '文案' },
        { id: 'e1', name: '小艾', avatar: null, position: '数据分析' },
      ];
      renderWindow();

      const list = employeesPassedToInput();
      expect(list.map((e: { id: string }) => e.id)).toEqual(['e1', 'e2']);
      // 职位来自订阅记录（会话里的 employee 对象没有 position）
      expect(list[0].position).toBe('数据分析');
    });

    it('会话无员工时列表只有订阅员工', () => {
      conversationData = { id: 'c1', messages: [], employee: undefined };
      subscribedData = [{ id: 'e2', name: '小博', avatar: null }];
      renderWindow();

      expect(employeesPassedToInput().map((e: { id: string }) => e.id)).toEqual(['e2']);
    });
  });

  describe('消息归属（authorOf）', () => {
    it('handledBy 命中订阅员工时归属该员工', () => {
      subscribedData = [{ id: 'e2', name: '小博', avatar: 'https://cdn/b.png' }];
      conversationData = {
        ...(conversationData as object),
        messages: [message({ metadata: { handledBy: 'e2' } })],
      };
      renderWindow();

      expect(bubbles()[0]).toHaveAttribute('data-author', '小博');
      expect(bubbles()[0]).toHaveAttribute('data-avatar', 'https://cdn/b.png');
    });

    it('handledBy 缺失（旧数据）时归属会话默认员工', () => {
      conversationData = {
        ...(conversationData as object),
        messages: [message({ metadata: null })],
      };
      renderWindow();

      expect(bubbles()[0]).toHaveAttribute('data-author', '小艾');
    });

    it('handledBy 指向已退订员工时回落到默认员工，不显示空作者', () => {
      conversationData = {
        ...(conversationData as object),
        messages: [message({ metadata: { handledBy: 'gone' } })],
      };
      renderWindow();

      expect(bubbles()[0]).toHaveAttribute('data-author', '小艾');
    });

    it('同一会话内多条消息各自保留归属', () => {
      subscribedData = [{ id: 'e2', name: '小博', avatar: null }];
      conversationData = {
        ...(conversationData as object),
        messages: [
          message({ id: 'm1', metadata: { handledBy: 'e1' } }),
          message({ id: 'm2', metadata: { handledBy: 'e2' } }),
          message({ id: 'm3', metadata: { handledBy: 'e1' } }),
        ],
      };
      renderWindow();

      expect(bubbles().map((b) => b.getAttribute('data-author'))).toEqual([
        '小艾',
        '小博',
        '小艾',
      ]);
    });
  });

  describe('消息过滤', () => {
    it('TOOL 角色消息不渲染成气泡', () => {
      conversationData = {
        ...(conversationData as object),
        messages: [
          message({ id: 'm1', role: 'USER', content: '问题' }),
          message({ id: 'm2', role: 'TOOL', content: '工具输出' }),
          message({ id: 'm3', role: 'ASSISTANT', content: '答案' }),
        ],
      };
      renderWindow();

      expect(bubbles()).toHaveLength(2);
      expect(screen.queryByText('工具输出')).not.toBeInTheDocument();
    });

    it('role 转成小写传给气泡', () => {
      conversationData = {
        ...(conversationData as object),
        messages: [message({ role: 'USER', content: '问题' })],
      };
      renderWindow();

      expect(bubbles()[0]).toHaveAttribute('data-role', 'user');
    });
  });

  describe('附件透传', () => {
    it('历史消息的附件数量传给气泡', () => {
      conversationData = {
        ...(conversationData as object),
        messages: [
          message({
            role: 'USER',
            attachments: [
              { type: 'image', key: 'k1', url: 'u1', name: '1.png', size: 1 },
              { type: 'document', key: 'k2', url: 'u2', name: '2.pdf', size: 2 },
            ],
          }),
        ],
      };
      renderWindow();

      expect(bubbles()[0]).toHaveAttribute('data-attachments', '2');
    });
  });

  describe('发送（handleSend）', () => {
    it('未指定员工时按会话默认员工发送', () => {
      renderWindow();
      fireEvent.click(screen.getByTestId('send-default'));

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const [convId, text, target, , attachments] = sendSpy.mock.calls[0];
      expect(convId).toBe('c1');
      expect(text).toBe('你好');
      expect(target).toBeUndefined();
      expect(attachments).toBeUndefined();
    });

    it('指定员工时 targetEmployeeId 原样透传', () => {
      subscribedData = [{ id: 'e2', name: '小博', avatar: null }];
      renderWindow();
      fireEvent.click(screen.getByTestId('send-to-e2'));

      expect(sendSpy.mock.calls[0][2]).toBe('e2');
    });

    it('附件随消息一起透传', () => {
      renderWindow();
      fireEvent.click(screen.getByTestId('send-with-file'));

      const attachments = sendSpy.mock.calls[0][4];
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({ name: '1.png', type: 'image' });
    });

    it('发送后立即出现乐观用户气泡（含附件）', () => {
      renderWindow();
      fireEvent.click(screen.getByTestId('send-with-file'));

      const userBubbles = bubbles().filter(
        (b) => b.getAttribute('data-role') === 'user',
      );
      expect(userBubbles).toHaveLength(1);
      expect(userBubbles[0]).toHaveTextContent('看图');
      expect(userBubbles[0]).toHaveAttribute('data-attachments', '1');
    });

    it('指定员工后流式气泡显示该员工，而非会话默认员工', () => {
      subscribedData = [{ id: 'e2', name: '小博', avatar: 'https://cdn/b.png' }];
      streamState = { ...streamState, streaming: true, text: '正在回复' };
      renderWindow();

      fireEvent.click(screen.getByTestId('send-to-e2'));

      const live = bubbles().find((b) => b.getAttribute('data-streaming') === '1');
      expect(live).toBeDefined();
      expect(live).toHaveAttribute('data-author', '小博');
    });

    it('未指定员工时流式气泡归属会话默认员工', () => {
      streamState = { ...streamState, streaming: true, text: '正在回复' };
      renderWindow();

      fireEvent.click(screen.getByTestId('send-default'));

      const live = bubbles().find((b) => b.getAttribute('data-streaming') === '1');
      expect(live).toHaveAttribute('data-author', '小艾');
    });
  });

  /**
   * 回归：流收完后 state.text 还留着整段回复，而刷新回来的历史里已经有了
   * 同一条消息 —— 两者同时渲染就是界面上「回复出现两遍、重进会话又只有一遍」
   * 的根因。判据用后端 done 事件给的 messageId：历史里出现这条 id，
   * 说明权威副本已到位，实时气泡必须让位。
   */
  describe('实时气泡与落库消息不重复', () => {
    const assistantBubbles = () =>
      bubbles().filter((b) => b.getAttribute('data-role') === 'assistant');

    it('落库消息到位后实时气泡撤掉，回复只显示一遍', async () => {
      streamState = { ...streamState, streaming: false, text: '这是一只红小龙虾。' };
      // onDone 触发时把「刷新回来的历史」换上，模拟 refetch 落地
      sendSpy.mockImplementation(
        async (
          _c: string,
          _t: string,
          _e: string | undefined,
          onDone?: (i: { messageId?: string; toolCalls: unknown[] }) => void,
        ) => {
          conversationData = {
            ...(conversationData as object),
            messages: [
              message({ id: 'u-1', role: 'USER', content: '这是什么' }),
              message({ id: 'a-1', role: 'ASSISTANT', content: '这是一只红小龙虾。' }),
            ],
          };
          await onDone?.({ messageId: 'a-1', toolCalls: [] });
          return 'ok';
        },
      );
      renderWindow();

      await act(async () => {
        fireEvent.click(screen.getByTestId('send-default'));
      });

      await waitFor(() => {
        expect(assistantBubbles()).toHaveLength(1);
      });
      expect(
        assistantBubbles().filter((b) =>
          b.textContent?.includes('这是一只红小龙虾。'),
        ),
      ).toHaveLength(1);
    });

    it('落库消息还没回来时实时气泡保留，不出现空档', async () => {
      streamState = { ...streamState, streaming: false, text: '这是一只红小龙虾。' };
      // 历史仍是空的：refetch 还没落地
      sendResolvesWith('a-1');
      renderWindow();

      await act(async () => {
        fireEvent.click(screen.getByTestId('send-default'));
      });

      // 权威副本没到位，实时气泡得继续顶着，否则用户会看到回复闪一下消失
      expect(assistantBubbles()).toHaveLength(1);
      expect(screen.getByText('这是一只红小龙虾。')).toBeInTheDocument();
    });

    it('done 事件没带 messageId 时靠历史增长兜底，同样不重复', async () => {
      streamState = { ...streamState, streaming: false, text: '这是一只红小龙虾。' };
      sendSpy.mockImplementation(
        async (
          _c: string,
          _t: string,
          _e: string | undefined,
          onDone?: (i: { messageId?: string; toolCalls: unknown[] }) => void,
        ) => {
          conversationData = {
            ...(conversationData as object),
            messages: [
              message({ id: 'u-1', role: 'USER', content: '这是什么' }),
              message({ id: 'a-1', role: 'ASSISTANT', content: '这是一只红小龙虾。' }),
            ],
          };
          await onDone?.({ toolCalls: [] }); // 没有 messageId
          return 'ok';
        },
      );
      renderWindow();

      await act(async () => {
        fireEvent.click(screen.getByTestId('send-default'));
      });

      await waitFor(() => {
        expect(assistantBubbles()).toHaveLength(1);
      });
    });

    it('收完流后清空流式状态，不留给下一轮', async () => {
      streamState = { ...streamState, streaming: false, text: '这是一只红小龙虾。' };
      sendResolvesWith('a-1');
      renderWindow();

      await act(async () => {
        fireEvent.click(screen.getByTestId('send-default'));
      });

      await waitFor(() => {
        expect(resetSpy).toHaveBeenCalled();
      });
    });

    it('乐观用户气泡在历史到位后撤掉，用户消息也只有一条', async () => {
      sendSpy.mockImplementation(
        async (
          _c: string,
          _t: string,
          _e: string | undefined,
          onDone?: (i: { messageId?: string; toolCalls: unknown[] }) => void,
        ) => {
          conversationData = {
            ...(conversationData as object),
            messages: [
              message({ id: 'u-1', role: 'USER', content: '你好' }),
              message({ id: 'a-1', role: 'ASSISTANT', content: '你好呀' }),
            ],
          };
          await onDone?.({ messageId: 'a-1', toolCalls: [] });
          return 'ok';
        },
      );
      renderWindow();

      await act(async () => {
        fireEvent.click(screen.getByTestId('send-default'));
      });

      await waitFor(() => {
        const users = bubbles().filter((b) => b.getAttribute('data-role') === 'user');
        expect(users).toHaveLength(1);
      });
    });
  });

  describe('流式与错误', () => {
    it('有流式文本时渲染实时气泡', () => {
      streamState = { ...streamState, streaming: true, text: '正在思考' };
      renderWindow();

      expect(screen.getByText('正在思考')).toBeInTheDocument();
    });

    it('仅有工具调用（还没出文本）也渲染实时气泡', () => {
      streamState = {
        ...streamState,
        streaming: true,
        toolCalls: [{ id: 't1', name: 'search' }],
      };
      renderWindow();

      expect(
        bubbles().some((b) => b.getAttribute('data-streaming') === '1'),
      ).toBe(true);
    });

    it('错误文案渲染出来', () => {
      streamState = { ...streamState, error: '模型调用失败' };
      renderWindow();

      expect(screen.getByText('模型调用失败')).toBeInTheDocument();
    });

    it('有错误时不再显示空态', () => {
      streamState = { ...streamState, error: '模型调用失败' };
      renderWindow();

      expect(screen.queryByText('开始和 小艾 对话')).not.toBeInTheDocument();
    });
  });

  describe('头部', () => {
    it('显示员工名与会话标题', () => {
      renderWindow();
      expect(screen.getByRole('heading', { name: '小艾' })).toBeInTheDocument();
      expect(screen.getByText('测试会话')).toBeInTheDocument();
    });

    it('无员工时头部用兜底文案', () => {
      conversationData = { id: 'c1', messages: [], employee: undefined };
      renderWindow();
      expect(screen.getByRole('heading', { name: '对话' })).toBeInTheDocument();
    });
  });
});
