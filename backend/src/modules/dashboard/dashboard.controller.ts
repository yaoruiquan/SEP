import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: '获取企业仪表盘数据' })
  async getDashboard(@Request() req) {
    return this.dashboardService.getEnterpriseStats(req.user.id);
  }

  @Get('stats')
  @ApiOperation({ summary: '获取企业仪表盘统计数据（旧接口，向后兼容）' })
  async getStats(@Request() req) {
    return this.dashboardService.getEnterpriseStats(req.user.id);
  }
}
