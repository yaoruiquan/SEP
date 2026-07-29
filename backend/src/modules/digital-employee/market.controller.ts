import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DigitalEmployeeService } from './digital-employee.service';

/**
 * 人才市场的**公开**接口 —— 刻意不挂 JwtAuthGuard。
 *
 * 为什么单独一个 controller，而不是在 DigitalEmployeeController 上加
 * `@Public()` 装饰器：
 * ① 公开面能在这一个文件里审计完 —— 想知道「访客能读到什么」只需读这里；
 * ② 装饰器方案漏一个就静默泄漏，而这里是「不加守卫才公开」，
 *    默认方向是安全的；
 * ③ 同一个 handler 若要按登录态返回不同字段，条件分支容易出错。
 *
 * 本 controller 的所有方法都必须走 service 的 findPublicXxx（白名单 select），
 * 不要图省事调 findAll / findOne —— 那两个会带出 systemPrompt。
 */
@ApiTags('market (public)')
@Controller('market')
export class MarketController {
  constructor(private readonly service: DigitalEmployeeService) {}

  @Get('employees')
  @ApiOperation({
    summary: '人才市场员工列表（公开，无需登录）',
    description:
      '只返回 PUBLISHED 员工，且不含 systemPrompt / modelId / maxSteps。' +
      'status 不可由调用方指定。',
  })
  @ApiQuery({ name: 'search', required: false, description: '搜索名称/描述/行业/岗位' })
  @ApiResponse({ status: 200, description: '已上架员工列表' })
  findAll(@Query('search') search?: string) {
    return this.service.findPublicList(search);
  }

  @Get('employees/:id')
  @ApiOperation({ summary: '人才市场员工详情（公开，无需登录）' })
  @ApiParam({ name: 'id', description: '员工模板 ID' })
  @ApiResponse({ status: 200, description: '员工详情' })
  @ApiResponse({ status: 404, description: '不存在或未上架' })
  findOne(@Param('id') id: string) {
    return this.service.findPublicOne(id);
  }
}
