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
      '**P3.1 两种发布路径**：\n' +
      '1. 上传 ZIP（file 字段）→ 平台存储文件 + 可下载\n' +
      '2. 填 packageRef（npm/git）→ 客户端用 pi install，平台不存文件\n' +
      '3. 两者并存 → ZIP 作为兜底，packageRef 优先\n\n' +
      '至少要有一种分发方式（file 或 packageRef），不能都为空。\n\n' +
      'Content-Type: multipart/form-data。表单字段：file（可选）+ version + packageRef[type]/packageRef[spec]（可选）+ changelog（可选）。',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['version'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'ZIP 文件（可选，≤ 20MB）' },
        version: { type: 'string', description: '版本号，格式 x.y.z' },
        'packageRef[type]': { type: 'string', enum: ['npm', 'git'], description: 'packageRef.type（可选）' },
        'packageRef[spec]': { type: 'string', example: '@sep/employee-video@1.2.0', description: 'packageRef.spec（可选）' },
        changelog: { type: 'string', description: '更新说明（可选，≤ 500 字）' },
      },
    },
  })
  @ApiResponse({ status: 201, description: '已发布' })
  @ApiResponse({ status: 400, description: '文件非 ZIP / 超过大小限制 / 版本号重复 / file 和 packageRef 都为空' })
  @ApiResponse({ status: 403, description: '非平台运营' })
  async publish(
    @Param('id') employeeId: string,
    @UploadedFile() file: UploadedZip | undefined,
    @Request() req: AuthedRequest,
    @Request() { body }: { body: Record<string, any> },
  ) {
    // 手动构造 packageRef（multipart 表单嵌套对象需这样处理）
    const packageRef = body['packageRef[type]'] && body['packageRef[spec]']
      ? { type: body['packageRef[type]'], spec: body['packageRef[spec]'] }
      : undefined;

    const dto = new ZodValidationPipe(PackagePublishDtoSchema).transform({
      version: body.version,
      changelog: body.changelog,
      packageRef,
    });

    return this.packages.publish(employeeId, req.user.id, dto, file);
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

  @Get('enterprise/instances/:id/package')
  @ApiOperation({
    summary: 'P3.2：获取实例可安装的包信息（客户端用）',
    description:
      '返回 packageRef（客户端用 pi install）+ ZIP 可用性（兜底通道）。\n' +
      '权限同下载接口：企业成员需对该实例有未过期授权，平台运营无需授权。',
  })
  @ApiParam({ name: 'id', description: '实例 ID' })
  @ApiResponse({ status: 200, description: 'packageRef + version + zipAvailable' })
  @ApiResponse({ status: 404, description: '实例不存在 / 无授权 / 无可用包' })
  async getInstancePackage(
    @Param('id') instanceId: string,
    @Request() req: AuthedRequest,
  ) {
    const isPlatformAdmin = req.user.role === 'ADMIN';
    const context = isPlatformAdmin
      ? undefined
      : await this.enterpriseCtx.resolve(req.user.id);

    return this.packages.getForInstance({
      instanceId,
      isPlatformAdmin,
      enterpriseId: context?.enterpriseId,
      memberId: context?.memberId,
      departmentId: context?.departmentId,
    });
  }

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
