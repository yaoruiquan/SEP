import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import {
  CreateOrderFromCartDtoSchema,
  GetOrdersQuerySchema,
} from './dto/order.dto';

@ApiTags('orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrderController {
  constructor(
    private orderService: OrderService,
    private enterpriseContext: EnterpriseContextService,
  ) {}

  @Post()
  @ApiOperation({ summary: '从购物车创建订单' })
  @ApiResponse({ status: 201, description: '订单创建成功' })
  @ApiResponse({ status: 400, description: '购物车为空或包含未审核员工' })
  async createFromCart(
    @Request() req,
    @Body(new ZodValidationPipe(CreateOrderFromCartDtoSchema)) body: { itemIds?: string[] },
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);

    return this.orderService.createFromCart(ctx.enterpriseId, req.user.id, body.itemIds);
  }

  @Get()
  @ApiOperation({ summary: '查询订单列表' })
  @ApiResponse({ status: 200, description: '订单列表' })
  async findAll(
    @Request() req,
    @Query(new ZodValidationPipe(GetOrdersQuerySchema)) query,
  ) {
    const { enterpriseId } = await this.enterpriseContext.resolve(req.user.id);
    return this.orderService.findAll(enterpriseId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询订单详情' })
  @ApiResponse({ status: 200, description: '订单详情' })
  @ApiResponse({ status: 404, description: '订单不存在' })
  async findOne(@Request() req, @Param('id') id: string) {
    const { enterpriseId } = await this.enterpriseContext.resolve(req.user.id);
    return this.orderService.findOne(id, enterpriseId);
  }
}
