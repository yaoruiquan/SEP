import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseAdapter } from './base.adapter';
import { AdapterInput, AdapterExecutionResult, AdapterConfig } from './adapter.interface';

@Injectable()
export class OpenCodeAdapter extends BaseAdapter {
  private readonly baseUrl: string;

  constructor(
    private config: ConfigService,
    private adapterConfig: AdapterConfig,
  ) {
    super('OpenCodeAdapter');
    this.baseUrl = this.config.get<string>('OPENCODE_API_BASE_URL') || 'http://localhost:4100';
  }

  async execute(input: AdapterInput): Promise<AdapterExecutionResult> {
    const start = Date.now();

    try {
      // 1. Create job
      const jobId = await this.createJob();
      this.logger.debug(`Job created: ${jobId}`);

      // 2. Upload user message as input
      await this.uploadInput(jobId, input.userMessage);

      // 3. Start execution
      await this.runJob(jobId, this.adapterConfig.skillName!);

      // 4. Poll until done
      const result = await this.pollUntilComplete(jobId);

      // 5. Fetch output
      const output = await this.fetchOutput(jobId);

      return {
        success: true,
        output,
        durationMs: this.elapsed(start),
        rawResponse: result,
      };
    } catch (error: any) {
      this.logger.error(`OpenCode execution failed: ${error.message}`, error.stack);
      return {
        success: false,
        output: '',
        durationMs: this.elapsed(start),
        error: error.message,
      };
    }
  }

  private async createJob(): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/jobs`, { method: 'POST' });
    if (!resp.ok) throw new Error(`Create job failed: ${resp.statusText}`);
    const data = await resp.json();
    return data.id;
  }

  private async uploadInput(jobId: string, message: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/jobs/${jobId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'input.txt', content: message }),
    });
    if (!resp.ok) throw new Error(`Upload input failed: ${resp.statusText}`);
  }

  private async runJob(jobId: string, skillName: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/jobs/${jobId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: skillName }),
    });
    if (!resp.ok) throw new Error(`Run job failed: ${resp.statusText}`);
  }

  private async pollUntilComplete(jobId: string, maxAttempts = 60): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const resp = await fetch(`${this.baseUrl}/jobs/${jobId}`);
      if (!resp.ok) throw new Error(`Poll job failed: ${resp.statusText}`);
      const data = await resp.json();

      if (data.status === 'completed' || data.status === 'done') return data;
      if (data.status === 'failed' || data.status === 'cancelled') {
        throw new Error(`Job ${data.status}: ${data.error || 'unknown'}`);
      }

      await this.sleep(1000); // Poll every 1s
    }
    throw new Error('Job timeout after 60s');
  }

  private async fetchOutput(jobId: string): Promise<string> {
    const listResp = await fetch(`${this.baseUrl}/jobs/${jobId}/outputs`);
    if (!listResp.ok) throw new Error(`List outputs failed: ${listResp.statusText}`);
    const files = await listResp.json();

    if (!files || files.length === 0) return '';

    const firstFile = files[0].path || files[0];
    const contentResp = await fetch(`${this.baseUrl}/jobs/${jobId}/outputs/${firstFile}`);
    if (!contentResp.ok) return '';
    return contentResp.text();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
