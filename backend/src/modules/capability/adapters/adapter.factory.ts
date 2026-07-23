import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CapabilityAdapter, AdapterConfig } from './adapter.interface';
import { OpenCodeAdapter } from './opencode.adapter';
import { CozeAdapter } from './coze.adapter';

@Injectable()
export class AdapterFactory {
  constructor(private configService: ConfigService) {}

  create(config: AdapterConfig): CapabilityAdapter {
    switch (config.platform.toUpperCase()) {
      case 'OPENCODE':
        if (!config.skillName) throw new Error('OpenCode adapter requires skillName');
        return new OpenCodeAdapter(this.configService, config);

      case 'COZE':
        if (!config.botId) throw new Error('Coze adapter requires botId');
        if (!config.apiKey) throw new Error('Coze adapter requires apiKey (PAT)');
        return new CozeAdapter(config);

      default:
        throw new Error(`Unsupported adapter platform: ${config.platform}`);
    }
  }
}
