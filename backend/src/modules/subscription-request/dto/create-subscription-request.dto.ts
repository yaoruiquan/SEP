import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class CreateSubscriptionRequestDto {
  @ApiProperty({ description: '申请订阅的硅基员工 ID' })
  @IsString()
  employeeId: string;

  @ApiProperty({ description: '申请理由/使用场景说明', required: false })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ description: '期望订阅时长（天），null 表示永久', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  requestedDays?: number;
}
