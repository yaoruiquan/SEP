import { Logger } from '@nestjs/common';
import { CapabilityAdapter, AdapterInput, AdapterExecutionResult } from './adapter.interface';

export abstract class BaseAdapter implements CapabilityAdapter {
  protected readonly logger: Logger;

  constructor(adapterName: string) {
    this.logger = new Logger(adapterName);
  }

  abstract execute(input: AdapterInput): Promise<AdapterExecutionResult>;

  protected elapsed(start: number): number {
    return Date.now() - start;
  }
}
