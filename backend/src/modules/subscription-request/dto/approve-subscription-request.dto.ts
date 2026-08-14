import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class ApproveSubscriptionRequestDto {
  @ApiProperty({ description: '审批意见', required: false })
  @IsOptional()
  @IsString()
  reviewNote?: string;

  @ApiProperty({ description: '批准的订阅时长（天），null 表示永久', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedDays?: number;
}
