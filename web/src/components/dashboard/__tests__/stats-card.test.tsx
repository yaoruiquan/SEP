import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsCard } from '../stats-card';

describe('StatsCard', () => {
  it('should render title and value', () => {
    render(
      <StatsCard
        title="Total Users"
        value={1234}
        icon={<span data-testid="icon">👤</span>}
      />,
    );

    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('1234')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('should render string value', () => {
    render(
      <StatsCard
        title="Revenue"
        value="$12.5K"
        icon={<span>💰</span>}
      />,
    );

    expect(screen.getByText('$12.5K')).toBeInTheDocument();
  });

  it('should show loading skeleton when loading is true', () => {
    render(
      <StatsCard
        title="Loading Stat"
        value={999}
        icon={<span>⏳</span>}
        loading={true}
      />,
    );

    expect(screen.getByText('Loading Stat')).toBeInTheDocument();
    // Value should not be visible during loading
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  it('should display positive trend with up arrow', () => {
    render(
      <StatsCard
        title="Active Users"
        value={500}
        icon={<span>📈</span>}
        trend={{ value: 12.5, isPositive: true }}
      />,
    );

    expect(screen.getByText(/↑/)).toBeInTheDocument();
    expect(screen.getByText(/12.5%/)).toBeInTheDocument();
  });

  it('should display negative trend with down arrow', () => {
    render(
      <StatsCard
        title="Churn Rate"
        value={3.2}
        icon={<span>📉</span>}
        trend={{ value: -5.8, isPositive: false }}
      />,
    );

    expect(screen.getByText(/↓/)).toBeInTheDocument();
    expect(screen.getByText(/5.8%/)).toBeInTheDocument();
  });

  it('should render without trend when not provided', () => {
    const { container } = render(
      <StatsCard
        title="Static Metric"
        value={100}
        icon={<span>🔢</span>}
      />,
    );

    // No trend arrows should be present
    expect(container.textContent).not.toMatch(/[↑↓]/);
  });

  it('should handle zero value', () => {
    render(
      <StatsCard
        title="Errors"
        value={0}
        icon={<span>✅</span>}
      />,
    );

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('should handle zero trend value', () => {
    render(
      <StatsCard
        title="No Change"
        value={100}
        icon={<span>➖</span>}
        trend={{ value: 0, isPositive: true }}
      />,
    );

    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });
});
