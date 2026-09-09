import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Key/value store behind PRD F-AD-91. Values are cached in memory for a minute because
 * almost every request reads at least one setting.
 */
@Injectable()
export class SettingsService {
  private cache: Map<string, unknown> | null = null;
  private cachedAt = 0;
  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cachedAt < SettingsService.TTL_MS) return this.cache;
    const rows = await this.prisma.setting.findMany();
    this.cache = new Map(rows.map((row) => [row.key, row.value]));
    this.cachedAt = Date.now();
    return this.cache;
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const all = await this.all();
    return all.has(key) ? (all.get(key) as T) : fallback;
  }

  /** Only non-secret values ever reach a browser. */
  async publicSettings(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany({ where: { secret: false } });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  invalidate(): void {
    this.cache = null;
  }
}
