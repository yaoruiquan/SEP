import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewCapabilityPage from './page';

const { createApi, createUrl, push } = vi.hoisted(() => ({ createApi: vi.fn(), createUrl: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/ui/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/features/admin/use-admin', () => ({
  useCreateCozeCapability: () => ({ mutateAsync: createApi }),
  useCreateCozeUrlCapability: () => ({ mutateAsync: createUrl }),
}));

function mount(mode: 'API' | 'URL') {
  render(<NewCapabilityPage />);
  fireEvent.click(screen.getByRole('button', { name: /Coze 扣子/ }));
  if (mode === 'URL') {
    fireEvent.click(screen.getByRole('button', { name: 'URL 链接' }));
    fireEvent.change(screen.getByPlaceholderText('https://www.coze.cn/store/bot/7xxxxxxxxxxxxxx'), { target: { value: 'https://www.coze.cn/store/bot/123' } });
  } else {
    fireEvent.change(screen.getByLabelText('Bot ID *'), { target: { value: '123' } });
  }
  fireEvent.change(screen.getByPlaceholderText('例如: 营销文案生成助手'), { target: { value: '测试能力' } });
}

beforeEach(() => {
  vi.clearAllMocks(); createApi.mockResolvedValue({ id: 'cap' }); createUrl.mockResolvedValue({ id: 'cap' });
});

describe('Coze 能力描述契约', () => {
  it.each(['API', 'URL'] as const)('%s 模式接受短描述', async (mode) => {
    mount(mode);
    fireEvent.change(screen.getByPlaceholderText('描述该能力的功能、使用场景和特点...'), { target: { value: '短描述' } });
    fireEvent.click(screen.getByRole('button', { name: '创建能力' }));
    const mutate = mode === 'API' ? createApi : createUrl;
    await waitFor(() => expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ description: '短描述' })));
    expect(screen.getByPlaceholderText('例如: 营销文案生成助手')).toHaveAttribute('maxLength', '100');
    expect(screen.getByPlaceholderText('描述该能力的功能、使用场景和特点...')).toHaveAttribute('maxLength', '2000');
  });

  it.each(['API', 'URL'] as const)('%s 模式拒绝空白描述', async (mode) => {
    mount(mode);
    fireEvent.change(screen.getByPlaceholderText('描述该能力的功能、使用场景和特点...'), { target: { value: ' \n ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建能力' }));
    expect(await screen.findByText('描述不能为空')).toBeInTheDocument();
    expect(createApi).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
  });

  it.each(['API', 'URL'] as const)('%s 模式接受 100/2000 边界并去除首尾空白', async (mode) => {
    mount(mode);
    fireEvent.change(screen.getByPlaceholderText('例如: 营销文案生成助手'), { target: { value: ` ${'a'.repeat(100)} ` } });
    fireEvent.change(screen.getByPlaceholderText('描述该能力的功能、使用场景和特点...'), { target: { value: ` ${'x'.repeat(2000)} ` } });
    fireEvent.click(screen.getByRole('button', { name: '创建能力' }));
    await waitFor(() => expect(mode === 'API' ? createApi : createUrl).toHaveBeenCalledWith(expect.objectContaining({
      name: 'a'.repeat(100), description: 'x'.repeat(2000),
    })));
  });

  it.each([
    ['API', 'name', 'a'.repeat(101)],
    ['URL', 'name', 'a'.repeat(101)],
    ['API', 'name', '   '],
    ['URL', 'name', '   '],
    ['API', 'description', 'x'.repeat(2001)],
    ['URL', 'description', 'x'.repeat(2001)],
  ] as const)('%s 模式拒绝非法 %s', async (mode, field, value) => {
    mount(mode);
    fireEvent.change(screen.getByPlaceholderText('描述该能力的功能、使用场景和特点...'), { target: { value: '短描述' } });
    fireEvent.change(screen.getByPlaceholderText(field === 'name' ? '例如: 营销文案生成助手' : '描述该能力的功能、使用场景和特点...'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '创建能力' }));
    await waitFor(() => expect(document.querySelector('p.text-danger')).toBeTruthy());
    expect(createApi).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
  });
});
