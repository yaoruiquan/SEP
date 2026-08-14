import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RequestStatus } from '@prisma/client';

describe('SubscriptionRequest E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let adminToken: string;
  let memberToken: string;
  let enterpriseId: string;
  let employeeId: string;
  let memberId: string;
  let adminMemberId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get<JwtService>(JwtService);

    // Cleanup
    await prisma.subscriptionRequest.deleteMany();
    await prisma.employeeGrant.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.enterpriseMember.deleteMany();
    await prisma.enterprise.deleteMany();
    await prisma.digitalEmployee.deleteMany();
    await prisma.user.deleteMany();

    // Create test data
    const adminUser = await prisma.user.create({
      data: {
        email: 'admin-sr@test.com',
        password: 'hashed',
        name: 'Admin User',
      },
    });

    const memberUser = await prisma.user.create({
      data: {
        email: 'member-sr@test.com',
        password: 'hashed',
        name: 'Member User',
      },
    });

    const enterprise = await prisma.enterprise.create({
      data: {
        name: 'Test Enterprise SR',
      },
    });
    enterpriseId = enterprise.id;

    const adminMember = await prisma.enterpriseMember.create({
      data: {
        enterpriseId: enterprise.id,
        userId: adminUser.id,
        role: 'ENTERPRISE_ADMIN',
      },
    });
    adminMemberId = adminMember.id;

    const member = await prisma.enterpriseMember.create({
      data: {
        enterpriseId: enterprise.id,
        userId: memberUser.id,
        role: 'MEMBER',
      },
    });
    memberId = member.id;

    const employee = await prisma.digitalEmployee.create({
      data: {
        name: 'Test Employee SR',
        description: 'Test Description',
        industry: 'Technology',
        position: 'Developer',
        systemPrompt: 'You are a helpful assistant',
        avatar: null,
        status: 'APPROVED',
      },
    });
    employeeId = employee.id;

    // Create tokens
    adminToken = jwtService.sign({ sub: adminUser.id, email: adminUser.email });
    memberToken = jwtService.sign({ sub: memberUser.id, email: memberUser.email });
  });

  afterAll(async () => {
    await prisma.subscriptionRequest.deleteMany();
    await prisma.employeeGrant.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.enterpriseMember.deleteMany();
    await prisma.enterprise.deleteMany();
    await prisma.digitalEmployee.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  describe('Full flow: Request → Approval → Grant', () => {
    let requestId: string;
    let subscriptionId: string;

    it('Step 1: Member creates subscription request', async () => {
      const response = await request(app.getHttpServer())
        .post('/subscription-requests')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          employeeId,
          reason: 'E2E test request',
          requestedDays: 30,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        enterpriseId,
        requesterId: memberId,
        employeeId,
        reason: 'E2E test request',
        requestedDays: 30,
        status: RequestStatus.PENDING,
      });

      requestId = response.body.id;
    });

    it('Step 2: Member can view their own requests', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscription-requests/my')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(requestId);
    });

    it('Step 3: Admin can view pending requests', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscription-requests/pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(requestId);
      expect(response.body[0].status).toBe(RequestStatus.PENDING);
    });

    it('Step 4: Admin approves the request', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/subscription-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reviewNote: 'Approved for testing',
          approvedDays: 30,
        })
        .expect(200);

      expect(response.body.request.status).toBe(RequestStatus.APPROVED);
      expect(response.body.subscription).toBeDefined();
      expect(response.body.grant).toBeDefined();

      subscriptionId = response.body.subscription.id;
    });

    it('Step 5: Verify subscription was created', async () => {
      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
      });

      expect(subscription).toBeDefined();
      expect(subscription?.enterpriseId).toBe(enterpriseId);
      expect(subscription?.employeeId).toBe(employeeId);
      expect(subscription?.status).toBe('ACTIVE');
    });

    it('Step 6: Verify grant was created for requester', async () => {
      const grant = await prisma.employeeGrant.findFirst({
        where: {
          subscriptionId,
          memberId,
        },
      });

      expect(grant).toBeDefined();
      expect(grant?.expiresAt).toBeDefined();
    });

    it('Step 7: Request no longer appears in pending list', async () => {
      const response = await request(app.getHttpServer())
        .get('/subscription-requests/pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveLength(0);
    });
  });

  describe('Request rejection flow', () => {
    let rejectRequestId: string;

    it('Member creates another request', async () => {
      // Create second employee to avoid conflict
      const employee2 = await prisma.digitalEmployee.create({
        data: {
          name: 'Test Employee SR 2',
          description: 'For rejection test',
          industry: 'Technology',
          position: 'Developer',
          systemPrompt: 'You are a helpful assistant',
          avatar: null,
          status: 'APPROVED',
        },
      });

      const response = await request(app.getHttpServer())
        .post('/subscription-requests')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          employeeId: employee2.id,
          reason: 'Will be rejected',
        })
        .expect(201);

      rejectRequestId = response.body.id;
    });

    it('Admin rejects the request', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/subscription-requests/${rejectRequestId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reviewNote: 'Budget constraints',
        })
        .expect(200);

      expect(response.body.status).toBe(RequestStatus.REJECTED);
      expect(response.body.reviewNote).toBe('Budget constraints');
    });

    it('No subscription or grant was created', async () => {
      const request = await prisma.subscriptionRequest.findUnique({
        where: { id: rejectRequestId },
      });

      expect(request?.subscriptionId).toBeNull();
    });
  });

  describe('Request cancellation flow', () => {
    let cancelRequestId: string;

    it('Member creates a request', async () => {
      const employee3 = await prisma.digitalEmployee.create({
        data: {
          name: 'Test Employee SR 3',
          description: 'For cancel test',
          industry: 'Technology',
          position: 'Developer',
          systemPrompt: 'You are a helpful assistant',
          avatar: null,
          status: 'APPROVED',
        },
      });

      const response = await request(app.getHttpServer())
        .post('/subscription-requests')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          employeeId: employee3.id,
          reason: 'Will be canceled',
        })
        .expect(201);

      cancelRequestId = response.body.id;
    });

    it('Member cancels their own request', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/subscription-requests/${cancelRequestId}/cancel`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({})
        .expect(200);

      expect(response.body.status).toBe(RequestStatus.CANCELED);
    });
  });

  describe('Validation and error cases', () => {
    it('Cannot create duplicate pending request', async () => {
      const employee4 = await prisma.digitalEmployee.create({
        data: {
          name: 'Test Employee SR 4',
          description: 'For duplicate test',
          industry: 'Technology',
          position: 'Developer',
          systemPrompt: 'You are a helpful assistant',
          avatar: null,
          status: 'APPROVED',
        },
      });

      await request(app.getHttpServer())
        .post('/subscription-requests')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ employeeId: employee4.id })
        .expect(201);

      await request(app.getHttpServer())
        .post('/subscription-requests')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ employeeId: employee4.id })
        .expect(409);
    });

    it('Member cannot approve requests', async () => {
      const req = await prisma.subscriptionRequest.findFirst({
        where: { status: RequestStatus.PENDING },
      });

      if (req) {
        await request(app.getHttpServer())
          .patch(`/subscription-requests/${req.id}/approve`)
          .set('Authorization', `Bearer ${memberToken}`)
          .send({})
          .expect(403);
      }
    });

    it('Cannot approve already processed request', async () => {
      const approved = await prisma.subscriptionRequest.findFirst({
        where: { status: RequestStatus.APPROVED },
      });

      if (approved) {
        await request(app.getHttpServer())
          .patch(`/subscription-requests/${approved.id}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({})
          .expect(400);
      }
    });
  });
});
