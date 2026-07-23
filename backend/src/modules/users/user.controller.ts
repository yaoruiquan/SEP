import { Controller, Get, Patch, Body, Request, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateProfileDtoSchema, ChangePasswordDtoSchema } from 'shared';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ApiOperation({ summary: '获取当前用户资料' })
  @ApiResponse({ status: 200, description: '用户资料' })
  getMe(@Request() req: any) {
    return this.userService.getProfile(req.user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: '更新当前用户资料（name / avatar）' })
  @ApiResponse({ status: 200, description: '更新后的用户资料' })
  updateMe(@Request() req: any, @Body() body: unknown) {
    const dto = UpdateProfileDtoSchema.parse(body);
    return this.userService.updateProfile(req.user.id, dto);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '修改密码' })
  @ApiResponse({ status: 204, description: '密码修改成功' })
  @ApiResponse({ status: 401, description: '当前密码不正确' })
  async changePassword(@Request() req: any, @Body() body: unknown) {
    const dto = ChangePasswordDtoSchema.parse(body);
    await this.userService.changePassword(req.user.id, dto);
  }
}
