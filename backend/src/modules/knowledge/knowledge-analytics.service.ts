import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface TopChunk {
  chunkId: string;
  content: string;
  source: string;
  hitCount: number;
}

export interface AnalyticsResponse {
  knowledgeBaseId: string;
  period: { from: Date; to: Date };
  totalSearches: number;
  testSearches: number;
  realSearches: number;
  averageHitCount: number;
  averageTopScore: number | null;
  zeroHitCount: number;
  zeroHitRate: number;
  zeroHitQueries: string[];
  /** 从未被检索到的文档（source 未出现在任何结果中） */
  neverHitDocuments: { id: string; originalName: string }[];
  recentLogs: {
    id: string;
    query: string;
    hitCount: number;
    topScore: number | null;
    strategy: string;
    isTest: boolean;
    durationMs: number | null;
    createdAt: Date;
  }[];
}

@Injectable()
export class KnowledgeAnalyticsService {
  private readonly logger = new Logger(KnowledgeAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAnalytics(
    knowledgeBaseId: string,
    enterpriseId: string,
    days = 30,
  ): Promise<AnalyticsResponse> {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, enterpriseId },
    });
    if (!kb) throw new NotFoundException('知识库不存在或无权访问');

    const from = new Date();
    from.setDate(from.getDate() - days);
    const to = new Date();

    // ── 检索日志聚合 ────────────────────────────────────────────────────────
    const logs = await this.prisma.knowledgeSearchLog.findMany({
      where: { knowledgeBaseId, createdAt: { gte: from } },
      orderBy: { createdAt: 'desc' },
      take: 500, // 防止超大结果集
    });

    const totalSearches = logs.length;
    const testSearches = logs.filter((l) => l.isTest).length;
    const realSearches = totalSearches - testSearches;

    const zeroHitLogs = logs.filter((l) => l.hitCount === 0);
    const zeroHitCount = zeroHitLogs.length;
    const zeroHitRate = totalSearches > 0 ? zeroHitCount / totalSearches : 0;

    // 去重零命中查询（取最近20条不重复）
    const zeroHitQueries = [
      ...new Set(zeroHitLogs.map((l) => l.query)),
    ].slice(0, 20);

    const avgHitCount =
      totalSearches > 0
        ? logs.reduce((sum, l) => sum + l.hitCount, 0) / totalSearches
        : 0;

    const scoresWithValue = logs.filter((l) => l.topScore !== null);
    const avgTopScore =
      scoresWithValue.length > 0
        ? scoresWithValue.reduce((sum, l) => sum + (l.topScore ?? 0), 0) /
          scoresWithValue.length
        : null;

    // ── 从未命中的文档（检索日志里没有这个 source 的文档）──────────────────
    const allDocuments = await this.prisma.document.findMany({
      where: { knowledgeBaseId, status: 'READY' },
      select: { id: true, originalName: true, filename: true },
    });

    // 从日志里提取出现过的 source 文件名集合（source = document.filename）
    // 注意：搜索结果 source 来自 TextChunk.source，即 document.filename
    const hitSources = new Set(
      (
        await this.prisma.textChunk.findMany({
          where: { knowledgeBaseId },
          select: { source: true },
          distinct: ['source'],
        })
      ).map((c) => c.source),
    );

    // 如果没有任何日志则无法判断命中，此处只列出没有对应 TextChunk 的文档
    const neverHitDocuments = allDocuments
      .filter((d) => !hitSources.has(d.filename))
      .map((d) => ({ id: d.id, originalName: d.originalName }));

    // ── 最近日志（50条）────────────────────────────────────────────────────
    const recentLogs = logs.slice(0, 50).map((l) => ({
      id: l.id,
      query: l.query,
      hitCount: l.hitCount,
      topScore: l.topScore,
      strategy: l.strategy,
      isTest: l.isTest,
      durationMs: l.durationMs,
      createdAt: l.createdAt,
    }));

    return {
      knowledgeBaseId,
      period: { from, to },
      totalSearches,
      testSearches,
      realSearches,
      averageHitCount: Math.round(avgHitCount * 100) / 100,
      averageTopScore: avgTopScore !== null ? Math.round(avgTopScore * 1000) / 1000 : null,
      zeroHitCount,
      zeroHitRate: Math.round(zeroHitRate * 1000) / 1000,
      zeroHitQueries,
      neverHitDocuments,
      recentLogs,
    };
  }
}
