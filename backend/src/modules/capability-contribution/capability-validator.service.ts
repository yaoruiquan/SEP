import { Injectable } from '@nestjs/common';
import type { AgentConfig } from '@prisma/client';

export type ValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type CapabilityValidationResult = {
  valid: boolean;
  kind: 'SKILL' | 'AGENT';
  checks: Array<{ code: string; passed: boolean; message: string }>;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
};

const SENSITIVE_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
  { code: 'SECRET_API_KEY', pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*[^\s`]{6,}/i, message: '正文疑似包含 API 密钥、Token 或密码' },
  { code: 'OPENAI_KEY', pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/, message: '正文疑似包含模型 API Key' },
  { code: 'PRIVATE_KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, message: '正文疑似包含私钥' },
];

const HEADING_ALIASES: Record<string, RegExp> = {
  role: /^(?:角色|人设|role|persona)$/i,
  input: /^(?:输入|输入参数|input|inputs)$/i,
  output: /^(?:输出|输出格式|output|outputs)$/i,
  steps: /^(?:步骤|流程|执行步骤|steps|workflow)$/i,
};

@Injectable()
export class CapabilityValidatorService {
  validateSkill(content: string): CapabilityValidationResult {
    const normalized = content.trim();
    const issues: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const checks: CapabilityValidationResult['checks'] = [];

    this.check(checks, issues, 'CONTENT_LENGTH', normalized.length >= 20, 'Skill 正文至少需要 20 个字符', 'content');
    const headings = this.extractHeadings(normalized);
    for (const [section, matcher] of Object.entries(HEADING_ALIASES)) {
      const passed = headings.some((heading) => matcher.test(heading));
      this.check(checks, issues, `SECTION_${section.toUpperCase()}`, passed, `Skill 正文需要包含“${section}”段落`, section);
    }
    for (const item of SENSITIVE_PATTERNS) {
      if (item.pattern.test(normalized)) issues.push({ code: item.code, message: item.message, path: 'content' });
    }
    const sensitiveCheck = !SENSITIVE_PATTERNS.some((item) => item.pattern.test(normalized));
    this.check(checks, issues, 'NO_SENSITIVE_CREDENTIALS', sensitiveCheck, '正文不能包含敏感凭据', 'content');
    if (!normalized.includes('```')) warnings.push({ code: 'NO_CODE_BLOCK', message: '建议使用代码块明确输入输出示例', path: 'content' });

    return { valid: issues.length === 0, kind: 'SKILL', checks, issues, warnings };
  }

  validateAgent(config: Pick<AgentConfig, 'platform' | 'botId' | 'workflowUrl' | 'skillName'>): CapabilityValidationResult {
    const issues: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const checks: CapabilityValidationResult['checks'] = [];
    const platform = String(config.platform || '').toUpperCase();
    const supported = ['COZE', 'DIFY', 'N8N', 'OPENCODE'].includes(platform);
    this.check(checks, issues, 'SUPPORTED_PLATFORM', supported, 'Agent 平台必须是 Coze、Dify、n8n 或 OpenCode', 'agentConfig.platform');

    const hasEndpoint = Boolean(config.workflowUrl?.trim()) || Boolean(config.botId?.trim());
    this.check(checks, issues, 'EXECUTION_ENDPOINT', hasEndpoint, 'Agent 至少需要提供 Bot ID 或工作流地址', 'agentConfig');
    if (config.workflowUrl) {
      let validUrl = false;
      try { validUrl = new URL(config.workflowUrl).protocol === 'https:'; } catch { validUrl = false; }
      this.check(checks, issues, 'HTTPS_WORKFLOW_URL', validUrl, '工作流地址必须是 HTTPS URL', 'agentConfig.workflowUrl');
    }
    if (!config.skillName?.trim()) warnings.push({ code: 'MISSING_SKILL_NAME', message: '建议填写外部 Agent 的能力名称', path: 'agentConfig.skillName' });
    return { valid: issues.length === 0, kind: 'AGENT', checks, issues, warnings };
  }

  private extractHeadings(content: string): string[] {
    return content.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
      return match ? [match[1].trim()] : [];
    });
  }

  private check(
    checks: CapabilityValidationResult['checks'],
    issues: ValidationIssue[],
    code: string,
    passed: boolean,
    message: string,
    path?: string,
  ) {
    checks.push({ code, passed, message });
    if (!passed) issues.push({ code, message, path });
  }
}
