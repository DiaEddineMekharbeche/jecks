import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

/**
 * Key/value store behind PRD F-AD-91. Values are cached in memory for a minute because
 * almost every request reads at least one setting.
 */
@Injectable()
export class SettingsService {
  private cache: Map<string, unknown> | null = null;
  private cachedAt = 0;
  private static readonly TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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

  /**
   * The theme's media, resolved to URLs the storefront can load.
   *
   * The settings store ids, because an id survives the file moving to a CDN and a URL
   * does not. The storefront needs the URL, and it should not have to make three more
   * requests to get it, so the bootstrap resolves them once.
   *
   * A key pointing at media that has since been deleted resolves to null rather than to
   * a broken URL: the header falls back to the shop's name, and the hero falls back to
   * the generated cap.
   */
  async themeAssets(): Promise<{
    logoUrl: string | null;
    faviconUrl: string | null;
    heroModelUrl: string | null;
  }> {
    const settings = await this.all();

    const ids = {
      logoUrl: settings.get('theme.logo_media_id'),
      faviconUrl: settings.get('theme.favicon_media_id'),
      heroModelUrl: settings.get('theme.hero_model_media_id'),
    };

    const wanted = Object.values(ids).filter((id): id is string => typeof id === 'string' && id !== '');
    if (wanted.length === 0) return { logoUrl: null, faviconUrl: null, heroModelUrl: null };

    const rows = await this.prisma.media.findMany({
      where: { id: { in: wanted }, deletedAt: null },
      select: { id: true, storageKey: true },
    });

    const keys = new Map(rows.map((row) => [row.id, row.storageKey]));
    const resolve = (id: unknown): string | null => {
      if (typeof id !== 'string') return null;
      const key = keys.get(id);
      return key ? this.storage.publicUrl(key) : null;
    };

    return {
      logoUrl: resolve(ids.logoUrl),
      faviconUrl: resolve(ids.faviconUrl),
      heroModelUrl: resolve(ids.heroModelUrl),
    };
  }

  invalidate(): void {
    this.cache = null;
  }
}
