import { Controller, Get, Param, Request, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request as ExpressRequest, Response } from 'express';
import { ClientSkillArtifactParams, ClientSkillArtifactParamsSchema } from 'shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientSkillArtifactService } from './client-skill-artifact.service';

@ApiTags('Client')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('client')
export class ClientSkillArtifactController {
  constructor(private readonly artifacts: ClientSkillArtifactService) {}

  @Get('subscriptions/:subscriptionId/skills/:capabilityId/versions/:versionId/artifact')
  @ApiOperation({ summary: '下载当前订阅实际生效的批准 Skill 安装产物（普通 access token）' })
  @ApiResponse({ status: 200, description: '原始 UTF-8 SKILL.md 或 ZIP 字节，无 JSON envelope；X-SHA256 为产物 hash' })
  @ApiResponse({ status: 400, description: '路径参数无效' })
  @ApiResponse({ status: 401, description: '未认证' })
  @ApiResponse({ status: 403, description: '无企业身份' })
  @ApiResponse({ status: 404, description: '无有效授权、绑定或该版本不再生效' })
  @ApiResponse({ status: 409, description: '批准内容无法安全安装；SKILL_ARTIFACT_BLOCKED' })
  @ApiResponse({ status: 503, description: 'Skill 包存储暂不可用，请有限重试' })
  async download(
    @Request() req: ExpressRequest & { user: { id: string } },
    @Param(new ZodValidationPipe(ClientSkillArtifactParamsSchema)) params: ClientSkillArtifactParams,
    @Res() res: Response,
  ) {
    const { descriptor, buffer } = await this.artifacts.download(req.user.id, params);
    res.setHeader('Content-Type', descriptor.format === 'zip' ? 'application/zip' : 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${descriptor.format === 'zip' ? 'skill.zip' : 'SKILL.md'}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-SHA256', descriptor.artifactSha256);
    return res.send(buffer);
  }
}
