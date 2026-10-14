import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewEmployeePage from './page';

const { createEmployee, bind, push, error } = vi.hoisted(() => ({
  createEmployee: vi.fn(), bind: vi.fn(), push: vi.fn(), error: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ toast: { error, success: vi.fn() } }));
vi.mock('@/features/admin/admin-api', () => ({ adminApi: { createEmployee, submitEmployeeForReview: vi.fn() } }));
vi.mock('@/features/admin/use-admin', () => ({
  useAvailableCapabilities: () => ({ data: [{ id: 'cap-1', name: '测试能力', description: '说明', type: 'AGENT' }], isLoading: false }),
  useBindCapabilities: () => ({ mutateAsync: bind }),
  useDefaultEmployeeGiftCNY: () => ({ data: 0 }),
  useDefaultEmployeeGiftPercentage: () => ({ data: 0 }),
}));
vi.mock('@/features/admin/use-models', () => ({ useEnabledModels: () => ({ data: [], isLoading: false }) }));

function mount() {
  render(<NewEmployeePage />);
  fireEvent.change(screen.getByLabelText('员工名称 *'), { target: { value: '测试员工' } });
  fireEvent.change(screen.getByLabelText('描述'), { target: { value: '短描述' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /测试能力/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  createEmployee.mockResolvedValue({ id: 'employee-1' });
  bind.mockResolvedValue(undefined);
});

describe('新建员工头像和描述契约', () => {
  it.each(['', '   '])('省略空头像 %j，允许短描述', async (avatar) => {
    mount();
    fireEvent.change(screen.getByLabelText('头像地址'), { target: { value: avatar } });
    fireEvent.click(screen.getByRole('button', { name: '保存为草稿' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/employees'));
    expect(createEmployee.mock.calls[0][0]).not.toHaveProperty('avatar');
    expect(createEmployee.mock.calls[0][0]).toMatchObject({ description: '短描述', includedComputeCNY: null });
    expect(bind).toHaveBeenCalledWith({ employeeId: 'employee-1', capabilityIds: ['cap-1'] });
  });

  it.each(['/assets/employees/silicon/frontend-engineer.webp', 'https://example.com/avatar.webp'])('接受共享头像地址 %s', async (avatar) => {
    mount();
    fireEvent.change(screen.getByLabelText('头像地址'), { target: { value: avatar } });
    fireEvent.click(screen.getByRole('button', { name: '保存为草稿' }));
    await waitFor(() => expect(createEmployee).toHaveBeenCalled());
    expect(createEmployee.mock.calls[0][0]).toMatchObject({ avatar });
  });

  it.each(['javascript:alert(1)', '/assets/other.webp', 'https://user:pass@example.com/avatar.webp'])('拒绝不符合共享头像契约的地址 %s', (avatar) => {
    mount();
    fireEvent.change(screen.getByLabelText('头像地址'), { target: { value: avatar } });
    fireEvent.click(screen.getByRole('button', { name: '保存为草稿' }));
    expect(error).toHaveBeenCalled();
    expect(createEmployee).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it.each(['', ' \n '])('草稿省略未填写的描述 %j', async (description) => {
    mount();
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: description } });
    fireEvent.click(screen.getByRole('button', { name: '保存为草稿' }));
    await waitFor(() => expect(createEmployee).toHaveBeenCalled());
    expect(createEmployee.mock.calls[0][0]).not.toHaveProperty('description');
  });

  it('接受 2000 字描述，并保留未被共享 pick 包含的员工配置', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: 'x'.repeat(2000) } });
    fireEvent.click(screen.getByRole('button', { name: '保存为草稿' }));
    await waitFor(() => expect(createEmployee).toHaveBeenCalled());
    expect(createEmployee.mock.calls[0][0]).toMatchObject({
      description: 'x'.repeat(2000), industry: '通用', position: '通用', modelId: 'gpt-4o',
      systemPrompt: '你是一位专业的硅基员工，随时准备协助用户完成各项任务。',
    });
  });

  it('拒绝超过 2000 字的员工描述，不进入绑定流程', () => {
    mount();
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: 'x'.repeat(2001) } });
    fireEvent.click(screen.getByRole('button', { name: '保存为草稿' }));
    expect(error).toHaveBeenCalled();
    expect(createEmployee).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it('显式填写赠送额度 0 不会变成默认额度 null', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('订阅赠送算力（元）'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '保存为草稿' }));
    await waitFor(() => expect(createEmployee).toHaveBeenCalled());
    expect(createEmployee.mock.calls[0][0]).toMatchObject({ includedComputeCNY: 0 });
  });
});
