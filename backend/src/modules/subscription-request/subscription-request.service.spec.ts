import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionRequestService } from './subscription-request.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { RequestStatus } from '@prisma/client';

describe('SubscriptionRequestService', () => {
  let service: SubscriptionRequestService;
  let prisma: any;
  let enterpriseContext: any;
  let subscriptionService: any;
  let notifications: any;

  const mockContext = {
    enterpriseId: 'ent-1',
    memberId: 'member-1',
    role: 'MEMBER' as const,
    departmentId: null,
  };

  const mockAdminContext = {
    enterpriseId: 'ent-1',
    memberId: 'admin-1',
    role: 'ENTERPRISE_ADMIN' as const,
    departmentId: null,
  };

  const mockEmployee = {
    id: 'emp-1',
    name: '市场营销专员',
    status: 'APPROVED' as const,
  };

  const mockRequest = {
    id: 'req-1',
    enterpriseId: 'ent-1',
    requesterId: 'member-1',
    requesterEmail: 'user@example.com',
    requesterName: 'Test User',
    employeeId: 'emp-1',
    reason: '需要用于市场推广',
    requestedDays: 30,
    status: RequestStatus.PENDING,
    reviewerId: null,
    reviewNote: null,
    reviewedAt: null,
    subscriptionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    employee: mockEmployee,
    requester: { id: 'member-1', userId: 'user-1', role: 'MEMBER' as const },
  };

  beforeEach(async () => {
    prisma = {
      digitalEmployee: {
        findUnique: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
      },
      subscriptionRequest: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      enterpriseMember: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;

    enterpriseContext = {
      resolve: jest.fn(),
      assertEnterpriseAdmin: jest.fn(),
    } as any;

    subscriptionService = {
      subscribe: jest.fn(),
    } as any;

    notifications = {
      create: jest.fn(),
      createBatch: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: EnterpriseContextService, useValue: enterpriseContext },
        { provide: SubscriptionService, useValue: subscriptionService },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<SubscriptionRequestService>(SubscriptionRequestService);
  });

  describe('createRequest', () => {
    it('should create subscription request successfully', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.digitalEmployee.findUnique.mockResolvedValue(mockEmployee as any);
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.subscriptionRequest.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com', name: 'Test User' } as any);
      prisma.subscriptionRequest.create.mockResolvedValue(mockRequest as any);
      prisma.enterpriseMember.findMany.mockResolvedValue([{ userId: 'admin-1' }] as any);
      notifications.createBatch.mockResolvedValue(undefined as any);

      const result = await service.createRequest('user-1', {
        employeeId: 'emp-1',
        reason: '需要用于市场推广',
        requestedDays: 30,
      });

      expect(result).toEqual(mockRequest);
      expect(prisma.subscriptionRequest.create).toHaveBeenCalled();
      expect(notifications.createBatch).toHaveBeenCalledWith(
        ['admin-1'],
        expect.objectContaining({
          type: 'SUBSCRIPTION_REQUEST_CREATED',
          title: '新的订阅申请',
        }),
      );
    });

    it('should throw NotFoundException if employee not found', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.digitalEmployee.findUnique.mockResolvedValue(null);

      await expect(
        service.createRequest('user-1', { employeeId: 'emp-999' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if already subscribed', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.digitalEmployee.findUnique.mockResolvedValue(mockEmployee as any);
      prisma.subscription.findUnique.mockResolvedValue({ status: 'ACTIVE' } as any);

      await expect(
        service.createRequest('user-1', { employeeId: 'emp-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if pending request exists', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.digitalEmployee.findUnique.mockResolvedValue(mockEmployee as any);
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.subscriptionRequest.findFirst.mockResolvedValue(mockRequest as any);

      await expect(
        service.createRequest('user-1', { employeeId: 'emp-1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('approveRequest', () => {
    it('should approve request and create subscription + grant', async () => {
      const mockSubscription = { id: 'sub-1', endDate: new Date('2025-12-31') };
      const mockGrant = { id: 'grant-1' };
      const updatedRequest = { ...mockRequest, status: RequestStatus.APPROVED };

      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue(mockRequest as any);
      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback({
          subscription: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
          employeeGrant: {
            create: jest.fn().mockResolvedValue(mockGrant),
          },
          subscriptionRequest: {
            update: jest.fn().mockResolvedValue(updatedRequest),
          },
        });
      });
      subscriptionService.subscribe.mockResolvedValue(mockSubscription as any);
      notifications.create.mockResolvedValue(undefined as any);

      const result = await service.approveRequest('admin-1', 'req-1', {});

      expect(result.request.status).toBe(RequestStatus.APPROVED);
      expect(subscriptionService.subscribe).toHaveBeenCalled();
    });

    it('should throw NotFoundException if request not found', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.approveRequest('admin-1', 'req-999', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if cross-enterprise access', async () => {
      enterpriseContext.resolve.mockResolvedValue({ ...mockAdminContext, enterpriseId: 'ent-2' });
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue(mockRequest as any);

      await expect(
        service.approveRequest('admin-1', 'req-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if request already processed', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue({
        ...mockRequest,
        status: RequestStatus.APPROVED,
      } as any);

      await expect(
        service.approveRequest('admin-1', 'req-1', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectRequest', () => {
    it('should reject request successfully', async () => {
      const updatedRequest = { ...mockRequest, status: RequestStatus.REJECTED };

      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue(mockRequest as any);
      prisma.subscriptionRequest.update.mockResolvedValue(updatedRequest as any);
      prisma.enterpriseMember.findUnique.mockResolvedValue({ userId: 'user-1' } as any);
      notifications.create.mockResolvedValue(undefined as any);

      const result = await service.rejectRequest('admin-1', 'req-1', {
        reviewNote: '预算不足',
      });

      expect(result.status).toBe(RequestStatus.REJECTED);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUBSCRIPTION_REQUEST_REJECTED',
          message: expect.stringContaining('预算不足'),
        }),
      );
    });
  });

  describe('cancelRequest', () => {
    it('should cancel own request successfully', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.subscriptionRequest.findUnique.mockResolvedValue(mockRequest as any);
      prisma.subscriptionRequest.update.mockResolvedValue({
        ...mockRequest,
        status: RequestStatus.CANCELED,
      } as any);

      const result = await service.cancelRequest('user-1', 'req-1');

      expect(result.status).toBe(RequestStatus.CANCELED);
    });

    it('should throw ForbiddenException if canceling others request', async () => {
      enterpriseContext.resolve.mockResolvedValue({ ...mockContext, memberId: 'member-2' });
      prisma.subscriptionRequest.findUnique.mockResolvedValue(mockRequest as any);

      await expect(
        service.cancelRequest('user-2', 'req-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMyRequests', () => {
    it('should return my requests', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.subscriptionRequest.findMany.mockResolvedValue([mockRequest] as any);

      const result = await service.getMyRequests('user-1');

      expect(result).toHaveLength(1);
      expect(prisma.subscriptionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { requesterId: 'member-1' },
        }),
      );
    });
  });

  describe('getPendingRequests', () => {
    it('should return pending requests for admin', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findMany.mockResolvedValue([mockRequest] as any);

      const result = await service.getPendingRequests('admin-1');

      expect(result).toHaveLength(1);
      expect(prisma.subscriptionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            enterpriseId: 'ent-1',
            status: RequestStatus.PENDING,
          },
        }),
      );
    });
  });

  describe('getAllRequests', () => {
    it('should return all requests for admin', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findMany.mockResolvedValue([mockRequest] as any);

      const result = await service.getAllRequests('admin-1');

      expect(result).toHaveLength(1);
      expect(prisma.subscriptionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            enterpriseId: 'ent-1',
          },
        }),
      );
    });

    it('should filter by status when provided', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findMany.mockResolvedValue([mockRequest] as any);

      await service.getAllRequests('admin-1', RequestStatus.APPROVED);

      expect(prisma.subscriptionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            enterpriseId: 'ent-1',
            status: RequestStatus.APPROVED,
          },
        }),
      );
    });
  });

  describe('createRequest - unapproved employee', () => {
    it('should throw BadRequestException if employee not approved', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.digitalEmployee.findUnique.mockResolvedValue({
        ...mockEmployee,
        status: 'PENDING',
      } as any);

      await expect(
        service.createRequest('user-1', { employeeId: 'emp-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveRequest - requester left enterprise', () => {
    it('should throw BadRequestException if requester no longer in enterprise', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue({
        ...mockRequest,
        requester: null,
      } as any);

      await expect(
        service.approveRequest('admin-1', 'req-1', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectRequest - validations', () => {
    it('should throw NotFoundException if request not found', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.rejectRequest('admin-1', 'req-999', { reviewNote: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if cross-enterprise access', async () => {
      enterpriseContext.resolve.mockResolvedValue({ ...mockAdminContext, enterpriseId: 'ent-2', departmentId: null });
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue(mockRequest as any);

      await expect(
        service.rejectRequest('admin-1', 'req-1', { reviewNote: 'test' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if request already processed', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockAdminContext);
      enterpriseContext.assertEnterpriseAdmin.mockReturnValue(undefined);
      prisma.subscriptionRequest.findUnique.mockResolvedValue({
        ...mockRequest,
        status: RequestStatus.REJECTED,
      } as any);

      await expect(
        service.rejectRequest('admin-1', 'req-1', { reviewNote: 'test' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelRequest - validations', () => {
    it('should throw NotFoundException if request not found', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.subscriptionRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelRequest('user-1', 'req-999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if request already processed', async () => {
      enterpriseContext.resolve.mockResolvedValue(mockContext);
      prisma.subscriptionRequest.findUnique.mockResolvedValue({
        ...mockRequest,
        status: RequestStatus.APPROVED,
      } as any);

      await expect(
        service.cancelRequest('user-1', 'req-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
