import { CapabilityValidatorService } from './capability-validator.service';

describe('CapabilityValidatorService', () => {
  const service = new CapabilityValidatorService();

  it('accepts a structured Skill without exposing or storing secret values', () => {
    const result = service.validateSkill(`# 角色\n你是数据分析师\n# 输入\n销售数据\n# 步骤\n分析趋势\n# 输出\n结构化报告`);

    expect(result.valid).toBe(true);
    expect(result.kind).toBe('SKILL');
    expect(result.issues).toEqual([]);
  });

  it('rejects a Skill with missing sections and credential-like content', () => {
    const result = service.validateSkill('api_key = sk-test-secret-value');

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'SECTION_ROLE',
      'SECTION_INPUT',
      'SECTION_OUTPUT',
      'SECTION_STEPS',
      'SECRET_API_KEY',
    ]));
  });

  it('accepts an Agent with a supported platform and HTTPS workflow', () => {
    const result = service.validateAgent({
      platform: 'N8N',
      botId: null,
      workflowUrl: 'https://automation.example.com/workflows/1',
      skillName: '销售周报',
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects an Agent without an execution endpoint or with an insecure URL', () => {
    const result = service.validateAgent({
      platform: 'DIFY',
      botId: null,
      workflowUrl: 'http://localhost/workflow',
      skillName: null,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['HTTPS_WORKFLOW_URL']));
  });
});
