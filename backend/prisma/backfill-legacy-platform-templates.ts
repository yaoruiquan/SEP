import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PrismaService } from '../src/prisma/prisma.service';
import { EnterpriseContextService } from '../src/modules/enterprise/enterprise-context.service';
import { CapabilityValidatorService } from '../src/modules/capability-contribution/capability-validator.service';
import { PackageSecurityService } from '../src/modules/capability-contribution/package-security.service';
import { EnterpriseSkillDefaultService } from '../src/modules/skill-version/enterprise-skill-default.service';
import { EnterpriseSkillReviewService } from '../src/modules/skill-version/enterprise-skill-review.service';
import { SkillVersionService } from '../src/modules/skill-version/skill-version.service';
import { PersonalWalletService } from '../src/modules/personal-wallet/personal-wallet.service';
import { SettingService } from '../src/modules/setting/setting.service';
import { SkillPackageService } from '../src/modules/skill-package/skill-package.service';
import { StorageService } from '../src/modules/upload/storage/storage.service';
import { LocalStorageDriver } from '../src/modules/upload/storage/local-storage.driver';
import { ClientSkillArtifactService } from '../src/modules/client/client-skill-artifact.service';
import { EmployeeReadinessService } from '../src/modules/digital-employee/employee-readiness.service';
import { backfillLegacyPlatformTemplates, LegacyTemplateReviewSchema } from '../src/modules/skill-version/legacy-platform-template-backfill';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', 'backend/.env'] })],
  providers: [PrismaService, EnterpriseContextService, CapabilityValidatorService, PackageSecurityService,
    EnterpriseSkillDefaultService, EnterpriseSkillReviewService, PersonalWalletService, SettingService, SkillVersionService,
    SkillPackageService, StorageService, LocalStorageDriver, ClientSkillArtifactService, EmployeeReadinessService],
})
export class LegacyTemplateMaintenanceModule {}

async function main() {
  const { values } = parseArgs({ options: {
    'review-file': { type: 'string' }, 'reviewer-id': { type: 'string' },
    report: { type: 'string' }, snapshot: { type: 'string' }, apply: { type: 'boolean', default: false },
    'accept-contribution-rewards': { type: 'boolean', default: false },
    'disable-contribution-rewards': { type: 'boolean', default: false },
  } });
  if (!values['review-file']) throw new Error('必须提供 --review-file（逐项审阅和原文哈希）');
  const reviews = LegacyTemplateReviewSchema.parse(JSON.parse(await readFile(values['review-file'], 'utf8')));
  const app = await NestFactory.createApplicationContext(LegacyTemplateMaintenanceModule, { logger: ['error', 'warn'] });
  try {
    const hostname = new URL(process.env.DATABASE_URL).hostname;
    if (values.apply && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
      throw new Error('此脚本只允许应用到本机数据库；远程环境须经明确授权的发布流程');
    }
    const settings = app.get(SettingService);
    if (values['disable-contribution-rewards'] && !values.apply) {
      throw new Error('停用奖励会修改配置，须显式提供 --apply');
    }
    if (values['disable-contribution-rewards']) {
      await settings.updateMany({ CONTRIBUTION_REWARDS_ENABLED: 'false' });
    }
    const rewardsEnabled = await settings.getEffectiveValue('CONTRIBUTION_REWARDS_ENABLED') === 'true';
    if (values.apply && rewardsEnabled && !values['accept-contribution-rewards']) {
      throw new Error('正常发布会增加贡献者钱包余额；确认该副作用后须提供 --accept-contribution-rewards');
    }
    const prisma = app.get(PrismaService);
    const versions = app.get(SkillVersionService);
    const preflight = await backfillLegacyPlatformTemplates(prisma, versions, reviews);
    const configured = Number(await settings.getEffectiveValue('CONTRIBUTION_PLATFORM_REWARD_CNY') ?? '50');
    const amount = Number.isFinite(configured) && configured > 0 ? configured : 50;
    const pendingIds = preflight.filter((row) => row.status === 'READY').map((row) => row.capabilityId);
    const existingRewards = await prisma.contributionRewardEvent.findMany({
      where: { dedupeKey: { in: pendingIds.map((id) => `platform-approved:${id}`) } }, select: { dedupeKey: true },
    });
    const alreadyRewarded = new Set(existingRewards.map((row) => row.dedupeKey));
    const rewarding = rewardsEnabled ? pendingIds.filter((id) => !alreadyRewarded.has(`platform-approved:${id}`)).length : 0;
    const sideEffects = { contributionRewardsEnabled: rewardsEnabled,
      contributionRewardsDisabledByRequest: values['disable-contribution-rewards'],
      contributionRewardPerCapabilityCNY: amount, newContributionRewards: rewarding,
      estimatedWalletCreditCNY: amount * rewarding, partialCompletionPossible: true };
    const financialState = async () => ({
      rewardEvents: await prisma.contributionRewardEvent.count(),
      rewardTransactions: await prisma.personalWalletTransaction.count({ where: { relatedType: 'contribution_reward' } }),
      wallets: await prisma.personalWallet.findMany({ orderBy: { id: 'asc' }, select: { id: true, balance: true } }),
    });
    const before = values.apply ? await financialState() : undefined;
    if (values.snapshot) {
      const sources = await prisma.capability.findMany({
        where: { id: { in: reviews.map((review) => review.capabilityId) } },
        select: { id: true, name: true, status: true, skillConfig: true },
      });
      // Never overwrite the pre-publication source evidence with a later approved template.
      await writeFile(values.snapshot, `${JSON.stringify({ capturedAt: new Date().toISOString(), databaseHost: hostname, sources }, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    let results;
    try {
      results = values.apply ? await backfillLegacyPlatformTemplates(prisma, versions, reviews,
        { apply: true, reviewerId: values['reviewer-id'] }) : preflight;
    } catch (error) {
      if (values.apply && values.report) {
        const currentVersions = await prisma.skillVersion.findMany({
          where: { capabilityId: { in: pendingIds }, scope: 'PLATFORM' },
          select: { id: true, capabilityId: true, status: true, version: true },
        });
        await writeFile(values.report, `${JSON.stringify({ applied: true, databaseHost: hostname,
          outcome: 'FAILED_OR_PARTIALLY_APPLIED', sideEffects, currentVersions,
          error: error instanceof Error ? error.message : '补版失败' }, null, 2)}\n`, 'utf8');
      }
      throw error;
    }
    const after = values.apply ? await financialState() : undefined;
    const report = JSON.stringify({ applied: values.apply, databaseHost: hostname, sideEffects, results,
      financialVerification: before && after ? {
        rewardEventsBefore: before.rewardEvents, rewardEventsAfter: after.rewardEvents,
        rewardTransactionsBefore: before.rewardTransactions, rewardTransactionsAfter: after.rewardTransactions,
        walletBalancesUnchanged: JSON.stringify(before.wallets) === JSON.stringify(after.wallets),
      } : undefined,
    }, null, 2);
    if (values.report) await writeFile(values.report, `${report}\n`, 'utf8');
    console.log(report);
  } finally {
    await app.close();
  }
}

if (require.main === module) void main().catch((error) => {
  console.error(error instanceof Error ? error.message : '补版失败');
  process.exitCode = 1;
});
