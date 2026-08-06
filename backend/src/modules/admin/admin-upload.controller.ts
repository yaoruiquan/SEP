import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { PrismaService } from '../../prisma/prisma.service';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const SKILLS_DIR = path.join(UPLOAD_DIR, 'skills');

// 确保目录存在
if (!fs.existsSync(SKILLS_DIR)) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

@ApiTags('admin/upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/capabilities')
export class AdminUploadController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('upload-skill')
  @ApiOperation({ summary: '上传 SKILL.md zip 包' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'zip 文件（必须包含 SKILL.md）',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: '上传成功，返回文件元数据' })
  @ApiResponse({ status: 400, description: '文件格式错误或缺少 SKILL.md' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, SKILLS_DIR);
        },
        filename: (req, file, cb) => {
          // 临时文件名，后续会重命名为 sha256
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `temp-${uniqueSuffix}.zip`);
        },
      }),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
      fileFilter: (req, file, cb) => {
        if (!file.originalname.endsWith('.zip')) {
          return cb(new BadRequestException('只支持 zip 文件'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadSkillZip(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('未上传文件');
    }

    const tempPath = file.path;

    try {
      // 1. 读取文件内容并计算 SHA256
      const fileBuffer = fs.readFileSync(tempPath);
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // 2. 验证 zip 文件必须包含 SKILL.md
      const zip = new AdmZip(tempPath);
      const zipEntries = zip.getEntries();
      const hasSkillMd = zipEntries.some((entry) =>
        entry.entryName.endsWith('SKILL.md'),
      );

      if (!hasSkillMd) {
        fs.unlinkSync(tempPath);
        throw new BadRequestException('zip 文件必须包含 SKILL.md');
      }

      // 3. 收集文件统计信息
      const fileCount = zipEntries.filter((e) => !e.isDirectory).length;
      const totalSize = file.size;

      // 4. 重命名为 sha256.zip
      const finalPath = path.join(SKILLS_DIR, `${sha256}.zip`);

      // 如果同样的文件已经存在，删除临时文件
      if (fs.existsSync(finalPath)) {
        fs.unlinkSync(tempPath);
      } else {
        fs.renameSync(tempPath, finalPath);
      }

      return {
        zipPath: `skills/${sha256}.zip`,
        sha256,
        fileCount,
        totalSize,
        filename: file.originalname,
      };
    } catch (error) {
      // 清理临时文件
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw error;
    }
  }

  @Get(':capabilityId/download-skill')
  @ApiOperation({ summary: '下载 SKILL zip 包' })
  @ApiResponse({ status: 200, description: '返回 zip 文件' })
  @ApiResponse({ status: 404, description: '能力不存在或不是 SKILL 类型' })
  async downloadSkill(
    @Param('capabilityId') capabilityId: string,
    @Res() res: Response,
  ) {
    // 1. 查询能力记录
    const capability = await this.prisma.capability.findUnique({
      where: { id: capabilityId },
    });

    if (!capability) {
      throw new NotFoundException('能力不存在');
    }

    if (capability.type !== 'SKILL') {
      throw new BadRequestException('只有 SKILL 类型能力可以下载');
    }

    // 2. 从 metadata 中获取 zipPath
    const metadata = capability.metadata as any;
    if (!metadata?.zipPath) {
      throw new NotFoundException('未找到 zip 文件路径');
    }

    // 3. 构建完整文件路径
    const filePath = path.join(UPLOAD_DIR, metadata.zipPath);

    // 4. 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('zip 文件不存在');
    }

    // 5. 返回文件
    res.download(filePath, `${capability.name}.zip`, (err) => {
      if (err) {
        console.error('下载失败:', err);
      }
    });
  }
}
