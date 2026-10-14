import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmployeeReadinessService } from '../src/modules/digital-employee/employee-readiness.service';
import { LegacyTemplateMaintenanceModule } from './backfill-legacy-platform-templates';

async function main() {
  const { values } = parseArgs({ options: { report: { type: 'string' } } });
  if (!values.report) throw new Error('必须提供 --report');
  const app = await NestFactory.createApplicationContext(LegacyTemplateMaintenanceModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const readiness = app.get(EmployeeReadinessService);
    const employees = await prisma.digitalEmployee.findMany({
      where: { status: 'APPROVED' }, orderBy: { id: 'asc' },
      select: { id: true, name: true, status: true, bindings: {
        where: { enabled: true }, orderBy: { id: 'asc' },
        select: { id: true, capabilityId: true, defaultSkillVersionId: true,
          capability: { select: { name: true, type: true } } },
      } },
    });
    const results = [];
    for (const employee of employees) {
      try {
        await readiness.assertReady(employee.id);
        results.push({ ...employee, readiness: 'READY' });
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        results.push({ ...employee, readiness: 'BLOCKED', diagnostics: error.getResponse() });
      }
    }
    const skillIds = [...new Set(employees.flatMap((employee) => employee.bindings
      .filter((binding) => binding.capability.type === 'SKILL').map((binding) => binding.capabilityId)))];
    const approvedVersions = await prisma.skillVersion.count({
      where: { capabilityId: { in: skillIds }, scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
    });
    const report = { auditedAt: new Date().toISOString(), databaseHost: new URL(process.env.DATABASE_URL).hostname,
      summary: { employees: employees.length, ready: results.filter((row) => row.readiness === 'READY').length,
        blocked: results.filter((row) => row.readiness === 'BLOCKED').length,
        enabledBindings: employees.reduce((total, row) => total + row.bindings.length, 0),
        uniqueSkills: skillIds.length, approvedVersions }, results };
    await writeFile(values.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report.summary, null, 2));
  } finally {
    await app.close();
  }
}

if (require.main === module) void main().catch((error) => {
  console.error(error instanceof Error ? error.message : '核查失败');
  process.exitCode = 1;
});
