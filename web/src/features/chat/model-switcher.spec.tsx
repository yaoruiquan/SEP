import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelSwitcher } from './model-switcher';

vi.mock('@/features/enterprise-settings/use-model-config', () => ({
  useAvailableModels: () => ({
    data: [
      {
        modelId: 'gpt-4o',
        label: 'GPT-4o',
        vendor: 'OpenAI',
        category: 'chat',
        contextLength: null,
        maxOutputTokens: null,
        pricingInputPer1M: null,
        pricingOutputPer1M: null,
        supportedFeatures: null,
        description: null,
      },
      {
        modelId: 'gemini-3.5-flash-high',
        label: 'Gemini 3.5 Flash High',
        vendor: 'Google',
        category: 'chat',
        contextLength: null,
        maxOutputTokens: null,
        pricingInputPer1M: null,
        pricingOutputPer1M: null,
        supportedFeatures: null,
        description: null,
      },
    ],
    isLoading: false,
  }),
}));

function renderSwitcher(
  canSwitch: boolean,
  policy: 'FOLLOW_TEMPLATE' | 'FORCE_DEFAULT' = 'FOLLOW_TEMPLATE',
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModelSwitcher
        conversationId="conversation-1"
        currentModelId={null}
        employeeModelId="gpt-4o"
        enterpriseDefaultModel="gemini-3.5-flash-high"
        employeeModelPolicy={policy}
        employeeDefaultModel="claude-sonnet-5"
        enterpriseId="enterprise-1"
        canSwitch={canSwitch}
      />
    </QueryClientProvider>,
  );
}

describe('ModelSwitcher', () => {
  beforeEach(() => vi.clearAllMocks());

  it('模型被锁定时展示企业默认模型而不是员工模板模型', () => {
    renderSwitcher(false);

    expect(screen.getByText('Gemini 3.5 Flash High')).toBeInTheDocument();
    expect(screen.queryByText('GPT-4o')).not.toBeInTheDocument();
  });

  it('允许切换时未选择模型也展示企业默认模型', () => {
    renderSwitcher(true);

    expect(screen.getByText('Gemini 3.5 Flash High')).toBeInTheDocument();
    expect(screen.queryByText('GPT-4o')).not.toBeInTheDocument();
  });

  it('FORCE_DEFAULT 时展示统一指定模型而不是员工模板模型', () => {
    renderSwitcher(true, 'FORCE_DEFAULT');

    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(screen.queryByText('GPT-4o')).not.toBeInTheDocument();
  });
});
