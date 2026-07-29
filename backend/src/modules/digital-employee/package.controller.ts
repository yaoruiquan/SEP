import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  PackagePublishDtoSchema,
  PACKAGE_MAX_BYTES,
} from 'shared';
import { PackageService, UploadedZip } from './package.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

type AuthedRequest = { user: { id: string; role: string } };

@ApiTags('Employee Packages')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PackageController {
  constructor(
    private readonly packages: PackageService,
    private readonly enterpriseCtx: EnterpriseContextService,
  ) {}

  // ── 运营端：上传与列表 ────────────────────────────────────────────────────

  @Post('digital-employees/:id/packages')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PACKAGE_MAX_BYTES },
      // MemoryStorage：文件放 buffer 里，服务自己存盘（便于控制路径与校验 ZIP 魔数）
    }),
  )
  @ApiOperation({
    summary: '发布新版本员工包（仅平台运营）',
    description:
      '上传对应版本的 ZIP 文件，同时更新 DigitalEmployee.version，触发已有实例的升级提示。\n\n' +
      'Content-Type: multipart/form-data。表单字段：file（ZIP 文件）+ version（x.y.z）+ changelog（可选）。',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'version'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'ZIP 文件（≤ 20MB）' },
        version: { type: 'string', description: '版本号，格式 x.y.z' },
        changelog: { type: 'string', description: '更新说明（可选，≤ 500 字）' },
      },
    },
  })
  @ApiResponse({ status: 201, description: '已发布' })
  @ApiResponse({ status: 400, description: '文件非 ZIP / 超过大小限制 / 版本号重复' })
  @ApiResponse({ status: 403, description: '非平台运营' })
  async publish(
    @Param('id') employeeId: string,
    // 用自定义的 UploadedZip 而非 Express.Multer.File ——
    // 项目未装 @types/multer，且服务层只需要这四个字段
    @UploadedFile() file: UploadedZip | undefined,
    @Request() req: AuthedRequest,
    // 表单的文本字段通过 Body 取，但文件上传时不能同时用 @Body(pipe)，
    // 改为手动 parse：multer 把文本字段放在 req.body
    @Request() { body }: { body: Record<string, string> },
  ) {
    const dto = new ZodValidationPipe(PackagePublishDtoSchema).transform(body);
    return this.packages.publish(employeeId, req.user.id, dto, {
      originalname: file?.originalname ?? 'package.zip',
      buffer: file?.buffer ?? Buffer.alloc(0),
      size: file?.size ?? 0,
    });
  }

  @Get('digital-employees/:id/packages')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '某员工的历史包列表（仅平台运营）' })
  @ApiParam({ name: 'id', description: '员工模板 ID' })
  @ApiResponse({ status: 200, description: '包列表，新版在前' })
  async listPackages(@Param('id') employeeId: string) {
    return this.packages.listForEmployee(employeeId);
  }

  // ── 成员端：下载 ──────────────────────────────────────────────────────────

  @Get('digital-employees/:id/package/download')
  @HttpCode(200)
  @ApiOperation({
    summary: '下载员工包（最新版）',
    description:
      '企业成员需对该员工模板的某个 ACTIVE 实例有未过期授权（直接或部门）。\n' +
      '平台运营无需授权。无权限时返回 404（不泄漏包是否存在）。\n\n' +
      '响应 Content-Disposition: attachment; filename="xxx.zip"，\n' +
      'X-SHA256 响应头携带十六进制摘要，供客户端校验完整性。',
  })
  @ApiParam({ name: 'id', description: '员工模板 ID' })
  @ApiResponse({ status: 200, description: 'ZIP 文件流' })
  @ApiResponse({ status: 404, description: '无可下载的包 / 无授权' })
  async downloadLatest(
    @Param('id') employeeId: string,
    @Request() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const isPlatformAdmin = req.user.role === 'ADMIN';
    let enterpriseId: string | undefined;
    let memberId: string | undefined;
    let departmentId: string | null | undefined;

    if (!isPlatformAdmin) {
      try {
        const ctx = await this.enterpriseCtx.resolve(req.user.id);
        enterpriseId = ctx.enterpriseId;
        memberId = ctx.memberId;
        departmentId = ctx.departmentId;
      } catch {
        // 不属于任何企业 → 拿到 403/500，统一用 404 掩盖
        throw new NotFoundException('该员工尚无可下载的员工包');
      }
    }

    const info = await this.packages.resolveDownload({
      employeeId,
      isPlatformAdmin,
      enterpriseId,
      memberId,
      departmentId,
    });

    // RFC 5987 编码保证中文文件名在多浏览器/curl 下正确显示
    const encoded = encodeURIComponent(info.filename);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
    );
    res.setHeader('Content-Length', info.fileSizeBytes);
    res.setHeader('X-SHA256', info.sha256);
    res.setHeader('X-Version', info.version);

    info.stream().pipe(res);
  }
}
