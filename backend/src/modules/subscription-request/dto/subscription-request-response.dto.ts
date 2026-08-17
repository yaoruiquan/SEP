import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionRequestResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  enterpriseId: string;

  @ApiProperty()
  requesterId: string | null;

  @ApiProperty()
  requesterEmail: string | null;

  @ApiProperty()
  requesterName: string | null;

  @ApiProperty()
  employeeId: string;

  @ApiProperty()
  employeeName: string;

  @ApiProperty()
  reason: string | null;

  @ApiProperty()
  requestedDays: number | null;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] })
  status: string;

  @ApiProperty({
    enum: ['SUBSCRIBE', 'GRANT'],
    description: '申请类型：SUBSCRIBE=订阅（付费）；GRANT=授权（免费）',
  })
  kind: string;

  @ApiProperty()
  reviewerId: string | null;

  @ApiProperty()
  reviewerName: string | null;

  @ApiProperty()
  reviewNote: string | null;

  @ApiProperty()
  reviewedAt: string | null;

  @ApiProperty()
  subscriptionId: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
