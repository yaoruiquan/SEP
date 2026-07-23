import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterFactory } from './adapters/adapter.factory';
import { AdapterInput, AdapterExecutionResult } from './adapters/adapter.interface';

@Injectable()
export class CapabilityService {
  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
  ) {}

  /**
   * 根据 capabilityId 找到对应的适配器并执行
   * 供 DigitalEmployee 对话层（Layer 5）调用
   */
  async execute(capabilityId: string, input: AdapterInput): Promise<AdapterExecutionResult> {
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
      include: { agentConfig: true },
    });

    if (!capability) throw new NotFoundException(`Capability ${capabilityId} not found`);
    if (!capability.agentConfig) {
      throw new NotFoundException(`No agent config for capability ${capabilityId}`);
    }

    const config = {
      platform: capability.agentConfig.platform,
      botId: capability.agentConfig.botId,
      apiKey: capability.agentConfig.apiKey,
      workflowUrl: capability.agentConfig.workflowUrl,
      skillName: capability.agentConfig.skillName,
    };

    const adapter = this.adapterFactory.create(config);
    return adapter.execute(input);
  }
}
