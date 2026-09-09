import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SavedView, SavedViewInput, SavedViewState } from '@jecks/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Saved list views — PRD-COMPLETION M1.0.
 *
 * A view belongs to the person who made it. Sharing makes it readable by anyone with
 * access to the module, but still editable only by its author, so one person cannot
 * silently rewrite a colleague's working filter.
 */
@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, module?: string): Promise<SavedView[]> {
    const rows = await this.prisma.savedView.findMany({
      where: {
        ...(module ? { module } : {}),
        OR: [{ userId }, { isShared: true }],
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => this.toDto(row, userId));
  }

  async create(userId: string, input: SavedViewInput): Promise<SavedView> {
    // Only one default per user per module, or the list would not know where to start.
    if (input.isDefault) await this.clearDefault(userId, input.module);

    const last = await this.prisma.savedView.findFirst({
      where: { userId, module: input.module },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const row = await this.prisma.savedView.create({
      data: {
        userId,
        module: input.module,
        name: input.name,
        state: input.state as never,
        isDefault: input.isDefault,
        isShared: input.isShared,
        position: (last?.position ?? -1) + 1,
      },
    });

    return this.toDto(row, userId);
  }

  async update(
    userId: string,
    id: string,
    input: Partial<Omit<SavedViewInput, 'module'>>,
  ): Promise<SavedView> {
    const existing = await this.mine(userId, id);

    if (input.isDefault) await this.clearDefault(userId, existing.module);

    const row = await this.prisma.savedView.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.state === undefined ? {} : { state: input.state as never }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        ...(input.isShared === undefined ? {} : { isShared: input.isShared }),
      },
    });

    return this.toDto(row, userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.mine(userId, id);
    await this.prisma.savedView.delete({ where: { id } });
  }

  /** Loads a view the caller owns, refusing someone else's even when it is shared. */
  private async mine(userId: string, id: string) {
    const row = await this.prisma.savedView.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That view does not exist' });
    }
    if (row.userId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the person who created a view can change it',
      });
    }
    return row;
  }

  private async clearDefault(userId: string, module: string): Promise<void> {
    await this.prisma.savedView.updateMany({
      where: { userId, module, isDefault: true },
      data: { isDefault: false },
    });
  }

  private toDto(
    row: {
      id: string;
      module: string;
      name: string;
      state: unknown;
      isDefault: boolean;
      isShared: boolean;
      position: number;
      userId: string;
    },
    userId: string,
  ): SavedView {
    return {
      id: row.id,
      module: row.module,
      name: row.name,
      state: (row.state ?? {}) as SavedViewState,
      isDefault: row.isDefault,
      isShared: row.isShared,
      position: row.position,
      isOwn: row.userId === userId,
    };
  }
}
