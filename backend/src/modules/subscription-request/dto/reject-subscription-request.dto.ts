import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RejectSubscriptionRequestDto {
  @ApiProperty({ description: '拒绝理由' })
  @IsString()
  reviewNote: string;
}
