import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from '../metric-card';
import { Bot, Users, DollarSign } from 'lucide-react';

describe('MetricCard', () => {
  it('should render title and value', () => {
    render(
      <MetricCard
        title="硅基员工"
        value={12}
        icon={Bot}
      />,
    );

    expect(screen.getByText('硅基员工')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('should render string value', () => {
    render(
      <MetricCard
        title="Revenue"
        value="¥25,000"
        icon={DollarSign}
      />,
    );

    expect(screen.getByText('¥25,000')).toBeInTheDocument();
  });

  it('should display upward trend with TrendingUp icon', () => {
    render(
      <MetricCard
        title="Active Users"
        value={500}
        icon={Users}
        trend={{ direction: 'up', value: 20 }}
      />,
    );

    expect(screen.getByText('20%')).toBeInTheDocument();
  });

  it('should display downward trend with TrendingDown icon', () => {
    render(
      <MetricCard
        title="Churn Rate"
        value={2.5}
        icon={Users}
        trend={{ direction: 'down', value: 15 }}
      />,
    );

    expect(screen.getByText('15%')).toBeInTheDocument();
  });

  it('should display trend label when provided', () => {
    render(
      <MetricCard
        title="Subscriptions"
        value={100}
        icon={Bot}
        trend={{ direction: 'up', value: 10, label: '较上月' }}
      />,
    );

    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('较上月')).toBeInTheDocument();
  });

  it('should render without trend when not provided', () => {
    const { container } = render(
      <MetricCard
        title="Static Metric"
        value={50}
        icon={Bot}
      />,
    );

    // No percentage should be present
    expect(container.textContent).not.toMatch(/%/);
  });

  it('should apply solid variant styles by default', () => {
    const { container } = render(
      <MetricCard
        title="Default Style"
        value={100}
        icon={Bot}
      />,
    );

    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('bg-white');
    expect(card.className).toContain('border-neutral-200');
  });

  it('should apply glass variant styles when specified', () => {
    const { container } = render(
      <MetricCard
        title="Glass Style"
        value={100}
        icon={Bot}
        variant="glass"
      />,
    );

    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('glass-card');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <MetricCard
        title="Custom Class"
        value={100}
        icon={Bot}
        className="custom-test-class"
      />,
    );

    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('custom-test-class');
  });

  it('should handle zero value', () => {
    render(
      <MetricCard
        title="Zero Count"
        value={0}
        icon={Bot}
      />,
    );

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('should handle large numbers', () => {
    render(
      <MetricCard
        title="Large Number"
        value={1234567}
        icon={Bot}
      />,
    );

    expect(screen.getByText('1234567')).toBeInTheDocument();
  });

  it('should render icon correctly', () => {
    const { container } = render(
      <MetricCard
        title="With Icon"
        value={100}
        icon={Bot}
      />,
    );

    // Lucide icons render as SVG elements
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should handle trend with zero percentage', () => {
    render(
      <MetricCard
        title="No Change"
        value={100}
        icon={Bot}
        trend={{ direction: 'up', value: 0 }}
      />,
    );

    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('should apply correct trend colors for glass variant', () => {
    const { container: upContainer } = render(
      <MetricCard
        title="Up Trend Glass"
        value={100}
        icon={Bot}
        variant="glass"
        trend={{ direction: 'up', value: 10 }}
      />,
    );

    const upTrend = upContainer.querySelector('.text-gsuccess');
    expect(upTrend).toBeInTheDocument();

    const { container: downContainer } = render(
      <MetricCard
        title="Down Trend Glass"
        value={100}
        icon={Bot}
        variant="glass"
        trend={{ direction: 'down', value: 10 }}
      />,
    );

    const downTrend = downContainer.querySelector('.text-gdanger');
    expect(downTrend).toBeInTheDocument();
  });

  it('should apply correct trend colors for solid variant', () => {
    const { container: upContainer } = render(
      <MetricCard
        title="Up Trend Solid"
        value={100}
        icon={Bot}
        variant="solid"
        trend={{ direction: 'up', value: 10 }}
      />,
    );

    const upTrend = upContainer.querySelector('.text-green-600');
    expect(upTrend).toBeInTheDocument();

    const { container: downContainer } = render(
      <MetricCard
        title="Down Trend Solid"
        value={100}
        icon={Bot}
        variant="solid"
        trend={{ direction: 'down', value: 10 }}
      />,
    );

    const downTrend = downContainer.querySelector('.text-red-600');
    expect(downTrend).toBeInTheDocument();
  });
});
