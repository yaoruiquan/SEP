import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MediaModelProfile, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';

export interface ManagedMediaCandidate {
  autoCreate?: boolean;
  modelId: string;
  displayName: string;
  operations: string[];
  executionMode: string;
  capabilities: Prisma.InputJsonValue;
}

export function mediaConnectionFingerprint(connection: { baseUrl: string; apiKey: string }): string {
  try {
    const apiKey = connection.apiKey;
    if (typeof apiKey !== 'string' || !apiKey || /[^\x21-\x7e]/.test(apiKey)) throw new Error();
    const raw = connection.baseUrl;
    if (typeof raw !== 'string' || !raw.trim()) throw new Error();
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    const base = url.href.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';
    return createHash('sha256').update(base + '\0' + apiKey).digest('hex');
  } catch {
    throw new ServiceUnavailableException('媒体连接配置无效');
  }
}

@Injectable()
export class MediaModelSyncService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingService) {}

  async sync(
    kind: 'image' | 'video',
    candidates: ManagedMediaCandidate[],
    expectedFingerprint: string,
    compatible: (row: MediaModelProfile) => boolean,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async tx => {
        const connection = await this.settings.getMediaConnection(kind, tx);
        if (mediaConnectionFingerprint(connection) !== expectedFingerprint) {
          throw new ConflictException('媒体连接已变更，请重新发现模型');
        }

        const existing = await tx.mediaModelProfile.findMany({ where: { kind } });
        const byModel = new Map<string, MediaModelProfile[]>();
        for (const row of existing) byModel.set(row.modelId, [...(byModel.get(row.modelId) ?? []), row]);

        const visible = new Map<string, ManagedMediaCandidate>();
        for (const candidate of [...candidates].sort((a, b) => a.modelId.localeCompare(b.modelId) ||
          a.displayName.localeCompare(b.displayName) || JSON.stringify(a).localeCompare(JSON.stringify(b)))) {
          if (!visible.has(candidate.modelId)) visible.set(candidate.modelId, candidate);
        }

        for (const [modelId, rows] of byModel) {
          const candidate = visible.get(modelId);
          for (const row of rows) {
            let verified = false;
            if (candidate) {
              try { verified = row.verified && compatible(row); } catch { verified = false; }
            }
            // Auto-discovered rows remain inert until an administrator has
            // explicitly configured and verified the profile.
            if (row.verified !== verified) {
              const result = await tx.mediaModelProfile.updateMany({
                where: { profileId: row.profileId, kind, configVersion: row.configVersion },
                data: { verified, configVersion: `cfg_${randomUUID()}` },
              });
              if (result.count !== 1) throw new ConflictException('媒体配置已并发变更，请重新加载');
            }
          }
        }

        for (const [modelId, candidate] of visible) {
          if (candidate.autoCreate === false) continue;
          if (byModel.has(modelId)) continue;
          const profileId = `auto-${kind}-${createHash('sha256').update(modelId).digest('hex').slice(0, 24)}`;
          const configVersion = `cfg_${randomUUID()}`;
          const proposed = {
            id: '', profileId, kind, modelId, displayName: candidate.displayName,
            operations: [...new Set(candidate.operations)], executionMode: candidate.executionMode,
            // Discovery creates an inert candidate. Authorization and verification
            // are explicit administrative actions, never inferred from /models.
            capabilities: candidate.capabilities, enabled: false, verified: false,
            configVersion, createdAt: new Date(0), updatedAt: new Date(0),
          } as MediaModelProfile;
          if (!compatible(proposed)) continue;
          const collision = existing.find(row => row.profileId === profileId);
          if (collision && collision.kind !== kind) throw new ConflictException('媒体模型 Profile ID 冲突');
          await tx.mediaModelProfile.create({
            data: {
              profileId, kind, modelId, displayName: candidate.displayName,
              operations: [...new Set(candidate.operations)].sort(), executionMode: candidate.executionMode,
              capabilities: candidate.capabilities, enabled: false, verified: false,
              configVersion,
            },
          });
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) {
        throw new ConflictException('媒体配置已并发变更，请重新加载');
      }
      throw error;
    }
  }
}
