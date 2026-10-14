import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AdminModule } from '../admin/admin.module';
import { AdminService } from '../admin/admin.service';
import { ClientModule } from '../client/client.module';
import { ClientSkillArtifactModule } from '../client/client-skill-artifact.module';
import { ClientSkillArtifactService } from '../client/client-skill-artifact.service';
import { SkillVersionModule } from '../skill-version/skill-version.module';
import { DigitalEmployeeModule } from './digital-employee.module';
import { DigitalEmployeeService } from './digital-employee.service';
import { EmployeeReadinessModule } from './employee-readiness.module';
import { EmployeeReadinessService } from './employee-readiness.service';

const importsOf = (module: any): any[] => Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) ?? [];

describe('Employee readiness module boundaries', () => {
  beforeAll(() => {
    process.env.NODE_ENV ??= 'test';
    process.env.JWT_SECRET ??= 'di-smoke-test-secret-that-is-long-enough';
  });

  it('keeps readiness and artifact imports acyclic and does not pull in ClientModule', () => {
    const visiting = new Set<any>();
    const visited = new Set<any>();
    const walk = (input: any) => {
      const module = input?.module ?? input;
      expect(module).toBeDefined();
      expect(module).not.toBe(ClientModule);
      expect(module).not.toBe(DigitalEmployeeModule);
      expect(visiting.has(module)).toBe(false);
      if (visited.has(module)) return;
      visiting.add(module);
      for (const child of importsOf(module)) walk(child);
      visiting.delete(module);
      visited.add(module);
    };
    walk(EmployeeReadinessModule);
    expect(visited.has(ClientSkillArtifactModule)).toBe(true);
    expect(visited.has(SkillVersionModule)).toBe(true);
    expect(importsOf(DigitalEmployeeModule)).toContain(EmployeeReadinessModule);
    expect(importsOf(AdminModule)).toContain(EmployeeReadinessModule);
    expect(importsOf(ClientModule)).toContain(ClientSkillArtifactModule);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ClientModule)).not.toContain(ClientSkillArtifactService);
  });

  it('compiles real AppModule imports with one shared readiness and artifact provider', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(RedisService).useValue({ getClient: jest.fn() })
      .compile();
    try {
      const readiness = moduleRef.get(EmployeeReadinessService);
      const artifact = moduleRef.get(ClientSkillArtifactService);
      expect(readiness).toBeInstanceOf(EmployeeReadinessService);
      expect(artifact).toBeInstanceOf(ClientSkillArtifactService);
      expect((moduleRef.get(AdminService) as any).readiness).toBe(readiness);
      expect((moduleRef.get(DigitalEmployeeService) as any).readiness).toBe(readiness);
      expect((readiness as any).artifacts).toBe(artifact);
      expect(moduleRef.select(ClientSkillArtifactModule).get(ClientSkillArtifactService, { strict: true })).toBe(artifact);
    } finally {
      await moduleRef.close();
    }
  }, 60_000);
});
