import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Request, UseGuards, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityService } from './capability.service';
import { CapabilityUploadDto } from 'shared';

@ApiTags('Capabilities')
@Controller('capabilities')
export class CapabilityController {
  constructor(private capabilityService: CapabilityService) {}

  // ────────────── Public / User browsing ──────────────

  @Get()
  @ApiOperation({ summary: 'Browse capabilities' })
  @ApiQuery({ name: 'type', required: false, enum: ['agent', 'rpa', 'skill', 'ai-app'] })
  @ApiQuery({ name: 'industry', required: false })
  @ApiQuery({ name: 'position', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of capabilities' })
  async findAll(
    @Query('type') type?: string,
    @Query('industry') industry?: string,
    @Query('position') position?: string,
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.capabilityService.findAll({ type, industry, position, status, page: +page, limit: +limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get capability details' })
  @ApiResponse({ status: 200, description: 'Capability found' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(@Param('id') id: string) {
    return this.capabilityService.findOne(id);
  }

  // ────────────── Contributor routes ──────────────

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload a new capability (Contributor / Admin)' })
  @ApiResponse({ status: 201, description: 'Capability created, pending review' })
  async create(
    @Body() dto: CapabilityUploadDto,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.capabilityService.create(req.user.id, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update capability (owner or Admin)' })
  @ApiResponse({ status: 200, description: 'Capability updated' })
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CapabilityUploadDto>,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.capabilityService.update(id, req.user.id, req.user.role, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete capability (owner or Admin)' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(
    @Param('id') id: string,
    @Request() req: { user: { id: string; role: string } },
  ) {
    await this.capabilityService.remove(id, req.user.id, req.user.role);
  }

  // ────────────── Admin review routes ──────────────

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve capability (Admin only)' })
  @ApiResponse({ status: 200, description: 'Capability approved' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async approve(
    @Param('id') id: string,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.capabilityService.approve(id, req.user.role);
  }

  @Post(':id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject capability (Admin only)' })
  @ApiResponse({ status: 200, description: 'Capability rejected' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async reject(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.capabilityService.reject(id, req.user.role, reason);
  }

  // ────────────── My capabilities (contributor) ──────────────

  @Get('mine/list')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List current contributor's capabilities" })
  @ApiResponse({ status: 200, description: 'List of own capabilities' })
  async findMine(@Request() req: { user: { id: string } }) {
    return this.capabilityService.findByContributor(req.user.id);
  }
}
