import { CapabilityValidatorService } from './capability-validator.service';

describe('CapabilityValidatorService', () => {
  const service = new CapabilityValidatorService();

  it('accepts a structured Skill without exposing or storing secret values', () => {
    const result = service.validateSkill(`# 角色\n你是数据分析师\n# 输入\n销售数据\n# 步骤\n分析趋势\n# 输出\n结构化报告`);

    expect(result.valid).toBe(true);
    expect(result.kind).toBe('SKILL');
    expect(result.issues).toEqual([]);
  });

  it('keeps missing sections as warnings while rejecting credential-like content', () => {
    const result = service.validateSkill('api_key = sk-test-secret-value');

    expect(result.valid).toBe(false);
    expect(result.warnings.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'SECTION_ROLE',
      'SECTION_INPUT',
      'SECTION_OUTPUT',
      'SECTION_STEPS',
    ]));
    expect(result.issues.map((issue) => issue.code)).toContain('SECRET_API_KEY');
    expect(result.issues.some((issue) => issue.code.startsWith('SECTION_'))).toBe(false);
  });

  it.each(['', '\n姚瑞泉测试'])('accepts existing business headings with an optional appended note: %p', (note) => {
    const result = service.validateSkill(`# 多平台经营协同\n你是 SEP 国内电商场景的能力模块。\n## 能力边界\n统一多平台口径和任务。\n## 工作要求\n仅使用授权数据。\n## 输出格式\n风险、待确认动作与所需补充数据${note}`);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'SECTION_ROLE', 'SECTION_INPUT', 'SECTION_STEPS', 'NO_CODE_BLOCK',
    ]);
    expect(result.warnings[0].message).toContain('建议');
  });

  it.each(['', ' ', '# 标题\n测试'])('still rejects empty or short content: %p', (content) => {
    const result = service.validateSkill(content);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('CONTENT_LENGTH');
  });

  it.each([
    ['api_key = example-secret-value', 'SECRET_API_KEY'],
    ['sk-example-secret-value', 'OPENAI_KEY'],
    ['-----BEGIN PRIVATE KEY-----', 'PRIVATE_KEY'],
  ])('still rejects credentials without requiring headings: %s', (content, code) => {
    const result = service.validateSkill(content);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(code);
    expect(JSON.stringify(result)).not.toContain(content);
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
