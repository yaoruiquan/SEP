import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateApiKeyDto,
  CreateApiKeyDtoSchema,
  ApiCallLogQueryDto,
  ApiCallLogQueryDtoSchema,
} from 'shared';
import { EnterpriseSettingsService } from './enterprise-settings.service';

type AuthedRequest = { user: { id: string } };

@ApiTags('Enterprise API Keys')
@Controller('enterprise/api-keys')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApiKeyController {
  constructor(private readonly service: EnterpriseSettingsService) {}

  @Get()
  @ApiOperation({ summary: '列出企业 API 密钥（不含明文）' })
  @ApiResponse({ status: 200 })
  list(@Request() req: AuthedRequest) {
    return this.service.listApiKeys(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: '创建 API 密钥 —— 明文仅此一次返回（仅企业管理员）' })
  @ApiResponse({ status: 201 })
  create(
    @Request() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateApiKeyDtoSchema)) dto: CreateApiKeyDto,
  ) {
    return this.service.createApiKey(req.user.id, dto);
  }

  @Delete(':keyId')
  @ApiOperation({ summary: '吊销 API 密钥（仅企业管理员）' })
  @ApiParam({ name: 'keyId' })
  @ApiResponse({ status: 204 })
  async revoke(
    @Request() req: AuthedRequest,
    @Param('keyId') keyId: string,
  ) {
    await this.service.revokeApiKey(req.user.id, keyId);
  }

  @Get('call-logs')
  @ApiOperation({ summary: '查询 API 调用日志（分页）' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'apiKeyId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200 })
  callLogs(
    @Request() req: AuthedRequest,
    @Query(new ZodValidationPipe(ApiCallLogQueryDtoSchema)) query: ApiCallLogQueryDto,
  ) {
    return this.service.listCallLogs(req.user.id, query);
  }
}
