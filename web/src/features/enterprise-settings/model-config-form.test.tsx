import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelConfigForm } from './model-config-form';
import type { EnterpriseModelConfig } from './use-model-config';

vi.mock('./model-whitelist-picker', () => ({ ModelWhitelistPicker: () => <div>模型白名单</div> }));
const config = {
  id: 'config', enterpriseId: 'enterprise', defaultChatModel: 'chat-model',
  allowedChatModels: [], allowUserSwitchModel: true,
  embeddingModel: 'platform-embedding', embeddingModelSource: 'platform',
  rerankModel: 'old-rerank', embeddingBatchSize: 16, embeddingTimeoutMs: 20000,
  employeeModelPolicy: 'FOLLOW_TEMPLATE', employeeDefaultModel: null,
  plannerModel: null, createdAt: '', updatedAt: '',
} as EnterpriseModelConfig;

describe('企业模型设置', () => {
  it('保留会话、员工、编排设置，不提交平台管理的知识库字段', () => {
    const save = vi.fn();
    render(<ModelConfigForm config={config} availableModels={[]} onSave={save} isSaving={false} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['会话模型', '员工模型', '编排模型']);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(save).toHaveBeenCalledWith({
      defaultChatModel: 'chat-model', allowedChatModels: [], allowUserSwitchModel: false,
      employeeModelPolicy: 'FOLLOW_TEMPLATE', employeeDefaultModel: null, plannerModel: null,
    });
  });
});
