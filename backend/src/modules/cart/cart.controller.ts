import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CartService } from './cart.service';
import { AddToCartDto, UpdateCartItemDto } from './dto/cart.dto';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import {
  AddToCartDtoSchema,
  UpdateCartItemDtoSchema,
} from './dto/cart.dto';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

@ApiTags('Cart')
@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出本企业购物车（含小计/总计）' })
  @ApiResponse({ status: 200, description: 'Cart summary' })
  async getCart(@Request() req: { user: { id: string } }) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    return this.cartService.getCart(ctx.enterpriseId);
  }

  @Post('items')
  @ApiOperation({ summary: '加入购物车（已存在则累加数量）' })
  @ApiResponse({ status: 201, description: 'Added to cart' })
  @ApiResponse({ status: 400, description: 'Employee not approved' })
  @ApiResponse({ status: 409, description: 'Already subscribed to this employee' })
  async addToCart(
    @Body(new ZodValidationPipe(AddToCartDtoSchema)) dto: AddToCartDto,
    @Request() req: { user: { id: string } },
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    return this.cartService.addToCart(ctx.enterpriseId, req.user.id, dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: '更新购物车项（数量/周期）' })
  @ApiResponse({ status: 200, description: 'Cart item updated' })
  @ApiResponse({ status: 404, description: 'Cart item not found' })
  @HttpCode(HttpStatus.OK)
  async updateCartItem(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCartItemDtoSchema))
    dto: UpdateCartItemDto,
    @Request() req: { user: { id: string } },
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    await this.cartService.updateCartItem(ctx.enterpriseId, id, dto);
    return { message: '购物车已更新' };
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '移除购物车项' })
  @ApiResponse({ status: 200, description: 'Cart item removed' })
  @ApiResponse({ status: 404, description: 'Cart item not found' })
  @HttpCode(HttpStatus.OK)
  async removeCartItem(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    await this.cartService.removeCartItem(ctx.enterpriseId, id);
    return { message: '已移除' };
  }

  @Delete()
  @ApiOperation({ summary: '清空购物车' })
  @ApiResponse({ status: 200, description: 'Cart cleared' })
  @HttpCode(HttpStatus.OK)
  async clearCart(@Request() req: { user: { id: string } }) {
    const ctx = await this.enterpriseContext.resolve(req.user.id);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    const result = await this.cartService.clearCart(ctx.enterpriseId);
    return { message: '购物车已清空', deletedCount: result.deletedCount };
  }
}
