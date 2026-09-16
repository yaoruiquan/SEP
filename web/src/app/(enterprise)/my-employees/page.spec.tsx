import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MyEmployeesPage from './page';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/features/enterprise/use-enterprise', () => ({
  useMyEmployees: mocks.query,
}));
vi.mock('@/lib/auth-store', () => ({
  useAuthStore: () => ({ roleInEnterprise: 'ENTERPRISE_ADMIN' }),
}));
const employees = [
  {
    subscriptionId: 'sub-z',
    name: 'Z 客服',
    templateVersion: '1',
    employee: {
      id: 'e-z',
      name: '客服',
      avatar: null,
      functionalCategory: 'SALES_CUSTOMER',
      position: '客户顾问',
      description: '处理用户反馈',
      bindings: [
        {
          id: 'b1',
          priority: 0,
          capability: {
            id: 'c1',
            name: '知识检索',
            type: 'SKILL',
            description: '',
          },
        },
      ],
    },
    grantSource: 'DIRECT',
  },
  {
    subscriptionId: 'sub-a',
    name: 'A 研发',
    templateVersion: '1',
    employee: {
      id: 'e-a',
      name: '研发',
      avatar: null,
      functionalCategory: 'TECH',
      position: '后端工程师',
      description: '编写代码',
    },
    grantSource: 'DEPARTMENT',
  },
];
beforeEach(() => {
  mocks.query.mockReturnValue({ data: employees });
});

describe('MyEmployeesPage', () => {
  it('按真实分类筛选，并显示完整列表分类数量', () => {
    render(<MyEmployeesPage />);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /研发与技术\s*1/ }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'A 研发' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /全部\s*2/ })).toBeTruthy();
  });
  it.each(['知识检索', '客户顾问', '处理用户反馈', '  Z 客服  '])(
    '可搜索技能、岗位、简介与名称：%s',
    (term) => {
      render(<MyEmployeesPage />);
      fireEvent.change(screen.getByRole('textbox', { name: '搜索硅基员工' }), {
        target: { value: term },
      });
      expect(screen.getAllByRole('article')).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'Z 客服' })).toBeTruthy();
    },
  );
  it('排序可切换，空结果可清除筛选', () => {
    render(<MyEmployeesPage />);
    fireEvent.change(screen.getByRole('combobox', { name: '排序' }), {
      target: { value: 'name' },
    });
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('A 研发');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '不存在' },
    });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
  it('页头不再借用营销或技能图片', () => {
    const { container } = render(<MyEmployeesPage />);
    expect(
      screen.getByRole('heading', { name: '硅基员工', level: 1 }),
    ).toBeTruthy();
    expect(
      container.querySelector(
        'img[src*="marketing/hero"], img[src*="capabilities/categories"]',
      ),
    ).toBeNull();
  });
});
