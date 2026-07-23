import { Controller, Post, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentRuntimeTestService } from './agent-runtime-test.service';

@ApiTags('Test - Agent Runtime')
@Controller('test/agent-runtime')
export class AgentRuntimeTestController {
  constructor(private testService: AgentRuntimeTestService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check for test endpoint' })
  healthCheck() {
    return {
      status: 'ok',
      message: 'Agent Runtime test endpoint is ready',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('basic-completion')
  @ApiOperation({ summary: 'Test 1.1: Basic text completion via sub2api' })
  async testBasicCompletion(@Body() body: { prompt: string }) {
    return this.testService.testBasicCompletion(body.prompt);
  }

  @Post('streaming')
  @ApiOperation({ summary: 'Test 1.2: Streaming response' })
  async testStreaming(@Body() body: { prompt: string }) {
    return this.testService.testStreaming(body.prompt);
  }

  @Post('tool-calling')
  @ApiOperation({ summary: 'Test 1.3: Single tool calling' })
  async testToolCalling(@Body() body: { prompt: string }) {
    return this.testService.testToolCalling(body.prompt);
  }

  @Post('multi-step-tools')
  @ApiOperation({ summary: 'Test 1.4: Multi-step tool calling' })
  async testMultiStepTools(@Body() body: { prompt: string }) {
    return this.testService.testMultiStepTools(body.prompt);
  }

  @Post('opencode-skill')
  @ApiOperation({ summary: 'Test 2.4: OpenCode Skill execution (via HTTP API)' })
  async testOpenCodeSkill(@Body() body: { prompt: string; skillName: string }) {
    return this.testService.testOpenCodeSkill(body.prompt, body.skillName);
  }

  @Post('end-to-end')
  @ApiOperation({ summary: 'Test 3: End-to-end integration test' })
  async testEndToEnd(@Body() body: { prompt: string }) {
    return this.testService.testEndToEnd(body.prompt);
  }
}
