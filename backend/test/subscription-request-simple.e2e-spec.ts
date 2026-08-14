import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RequestStatus } from '@prisma/client';
import { SubscriptionRequestModule } from '../src/modules/subscription-request/subscription-request.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { EnterpriseModule } from '../src/modules/enterprise/enterprise.module';
import { SubscriptionModule } from '../src/modules/subscription/subscription.module';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';

describe('SubscriptionRequest E2E (Simple)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let adminToken: string;
  let memberToken: string;
  let enterpriseId: string;
  let employeeId: string;
  let memberId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuthModule,
        EnterpriseModule,
        SubscriptionModule,
        NotificationsModule,
        SubscriptionRequestModule,
      ],
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
    await prisma.walletTransaction.deleteMany();
    await prisma.enterpriseWallet.deleteMany();
    await prisma.enterpriseMember.deleteMany();
    await prisma.enterprise.deleteMany();
    await prisma.capability.deleteMany();
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

    // Create enterprise wallet with sufficient balance
    await prisma.enterpriseWallet.create({
      data: {
        enterpriseId: enterprise.id,
        balance: 100000,
        frozenAmount: 0,
        totalDeposit: 100000,
        totalConsume: 0,
        totalRefund: 0,
        version: 1,
      },
    });

    await prisma.enterpriseMember.create({
      data: {
        enterpriseId: enterprise.id,
        userId: adminUser.id,
        role: 'ENTERPRISE_ADMIN',
      },
    });

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
        status: 'APPROVED',
        annualPriceCNY: 1000,
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
    await prisma.walletTransaction.deleteMany();
    await prisma.enterpriseWallet.deleteMany();
    await prisma.enterpriseMember.deleteMany();
    await prisma.enterprise.deleteMany();
    await prisma.capability.deleteMany();
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
        });

      console.log('Approve response status:', response.status);
      console.log('Approve response body:', JSON.stringify(response.body, null, 2));

      expect(response.status).toBe(200);
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
});
