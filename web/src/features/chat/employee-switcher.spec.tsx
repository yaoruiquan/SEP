import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmployeeSwitcher, type SwitchableEmployee } from './employee-switcher';

const alice: SwitchableEmployee = {
  id: 'e1',
  name: '小艾',
  avatar: null,
  position: '数据分析师',
};
const bob: SwitchableEmployee = {
  id: 'e2',
  name: '小博',
  avatar: 'https://cdn.example.com/bob.png',
  position: '文案策划',
};
const carol: SwitchableEmployee = { id: 'e3', name: '小卡', avatar: null };

describe('EmployeeSwitcher', () => {
  describe('显隐', () => {
    it('无员工时不渲染', () => {
      const { container } = render(
        <EmployeeSwitcher employees={[]} activeId="" onSelect={vi.fn()} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('只有一位员工时不渲染（没得切换就不占空间）', () => {
      const { container } = render(
        <EmployeeSwitcher
          employees={[alice]}
          activeId="e1"
          onSelect={vi.fn()}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it('两位及以上才渲染', () => {
      render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e1"
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    });
  });

  describe('无障碍语义', () => {
    it('容器是 radiogroup 且有可读标签', () => {
      render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e1"
          onSelect={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('radiogroup', { name: '选择回复本条消息的员工' }),
      ).toBeInTheDocument();
    });

    it('每位员工一个 radio，选中项 aria-checked 为 true', () => {
      render(
        <EmployeeSwitcher
          employees={[alice, bob, carol]}
          activeId="e2"
          onSelect={vi.fn()}
        />,
      );

      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(3);
      expect(radios[0]).toHaveAttribute('aria-checked', 'false');
      expect(radios[1]).toHaveAttribute('aria-checked', 'true');
      expect(radios[2]).toHaveAttribute('aria-checked', 'false');
    });

    it('title 带上职位，便于悬停辨认未展开的头像', () => {
      render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e1"
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getAllByRole('radio')[0]).toHaveAttribute(
        'title',
        '小艾 · 数据分析师',
      );
    });

    it('无职位时 title 只有名字', () => {
      render(
        <EmployeeSwitcher
          employees={[carol, alice]}
          activeId="e3"
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getAllByRole('radio')[0]).toHaveAttribute('title', '小卡');
    });
  });

  describe('名字展开策略', () => {
    it('只有选中项展开名字（其余仅头像，避免挤满整行）', () => {
      render(
        <EmployeeSwitcher
          employees={[alice, bob, carol]}
          activeId="e1"
          onSelect={vi.fn()}
        />,
      );

      // 选中的小艾展开文字名
      const activeRadio = screen.getAllByRole('radio')[0];
      expect(activeRadio).toHaveTextContent('小艾');
      // 未选中的只有头像首字，没有完整名字文本节点
      expect(screen.getAllByRole('radio')[1]).not.toHaveTextContent('小博');
    });

    it('切换选中项后展开的名字随之改变', () => {
      const { rerender } = render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e1"
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getAllByRole('radio')[0]).toHaveTextContent('小艾');

      rerender(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e2"
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getAllByRole('radio')[1]).toHaveTextContent('小博');
      expect(screen.getAllByRole('radio')[0]).not.toHaveTextContent('小艾');
    });

    it('activeId 不匹配任何员工时不崩，也不展开任何名字', () => {
      render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="nonexistent"
          onSelect={vi.fn()}
        />,
      );
      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(2);
      for (const r of radios) {
        expect(r).toHaveAttribute('aria-checked', 'false');
      }
    });
  });

  describe('选中项职位', () => {
    it('展示当前员工职位', () => {
      render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e2"
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByText('文案策划')).toBeInTheDocument();
    });

    it('当前员工无职位时不渲染该区域', () => {
      render(
        <EmployeeSwitcher
          employees={[carol, alice]}
          activeId="e3"
          onSelect={vi.fn()}
        />,
      );
      expect(screen.queryByText('数据分析师')).not.toBeInTheDocument();
    });
  });

  describe('交互', () => {
    it('点击未选中员工回传其 id', () => {
      const onSelect = vi.fn();
      render(
        <EmployeeSwitcher
          employees={[alice, bob, carol]}
          activeId="e1"
          onSelect={onSelect}
        />,
      );

      fireEvent.click(screen.getAllByRole('radio')[2]);

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('e3');
    });

    it('点击已选中项也回传（由父组件决定是否忽略）', () => {
      const onSelect = vi.fn();
      render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e1"
          onSelect={onSelect}
        />,
      );

      fireEvent.click(screen.getAllByRole('radio')[0]);

      expect(onSelect).toHaveBeenCalledExactlyOnceWith('e1');
    });

    it('disabled 时按钮禁用且点击不回调（流式回复中不允许改路由）', () => {
      const onSelect = vi.fn();
      render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e1"
          onSelect={onSelect}
          disabled
        />,
      );

      const radios = screen.getAllByRole('radio');
      for (const r of radios) expect(r).toBeDisabled();

      fireEvent.click(radios[1]);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('未传 disabled 时按钮可用', () => {
      render(
        <EmployeeSwitcher
          employees={[alice, bob]}
          activeId="e1"
          onSelect={vi.fn()}
        />,
      );
      for (const r of screen.getAllByRole('radio')) {
        expect(r).toBeEnabled();
      }
    });
  });

  describe('渲染顺序', () => {
    it('按传入顺序渲染（会话默认员工排首位由父组件保证）', () => {
      render(
        <EmployeeSwitcher
          employees={[carol, alice, bob]}
          activeId="e3"
          onSelect={vi.fn()}
        />,
      );

      const titles = screen
        .getAllByRole('radio')
        .map((r) => r.getAttribute('title'));
      expect(titles).toEqual(['小卡', '小艾 · 数据分析师', '小博 · 文案策划']);
    });
  });
});
