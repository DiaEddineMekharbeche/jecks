import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@jecks/db';
import {
  CATALOG_ERRORS,
  type CategoryMoveInput,
  type CategoryNode,
  type CategoryPatchInput,
  type CategoryReorderInput,
  type Translated,
} from '@jecks/shared';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';

/**
 * The category tree — PRD F-AD-11, storage per DECISIONS D09.
 *
 * Each row keeps its parent id and a materialized `path` of ancestor slugs. Reads are
 * then a prefix match rather than a recursive query, and the cost lands on writes: a
 * move rewrites the path of the node and of everything under it, in one transaction.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** The whole tree in one query — a catalogue has tens of categories, not thousands. */
  async tree(): Promise<CategoryNode[]> {
    const rows = await this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ depth: 'asc' }, { position: 'asc' }],
      include: {
        media: { select: { storageKey: true } },
        _count: { select: { products: true } },
      },
    });

    const nodes = new Map<string, CategoryNode>();
    for (const row of rows) {
      nodes.set(row.id, {
        id: row.id,
        name: (row.name ?? {}) as Translated,
        slug: row.slug,
        parentId: row.parentId,
        path: row.path,
        depth: row.depth,
        position: row.position,
        published: row.published,
        mediaId: row.mediaId,
        mediaUrl: this.storage.publicUrl(row.media?.storageKey),
        seoTitle: (row.seoTitle ?? null) as Translated | null,
        seoDescription: (row.seoDescription ?? null) as Translated | null,
        description: (row.description ?? null) as Translated | null,
        productCount: row._count.products,
        children: [],
      });
    }

    const roots: CategoryNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    return roots;
  }

  async get(id: string): Promise<CategoryNode> {
    const found = findNode(await this.tree(), id);
    if (!found) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That category does not exist' });
    }
    return found;
  }

  async create(input: CategoryPatchInput): Promise<CategoryNode> {
    if (!input.name || !input.slug) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'A category needs a name and a slug',
      });
    }
    await this.assertSlugFree(input.slug);

    const parent = input.parentId ? await this.load(input.parentId) : null;
    const created = await this.prisma.category.create({
      data: {
        name: input.name as Prisma.InputJsonValue,
        slug: input.slug,
        description: (input.description ?? undefined) as Prisma.InputJsonValue | undefined,
        parentId: parent?.id ?? null,
        position: input.position ?? (await this.nextPosition(parent?.id ?? null)),
        mediaId: input.mediaId ?? null,
        seoTitle: (input.seoTitle ?? undefined) as Prisma.InputJsonValue | undefined,
        seoDescription: (input.seoDescription ?? undefined) as Prisma.InputJsonValue | undefined,
        published: input.published ?? true,
        path: pathFor(parent, input.slug),
        depth: parent ? parent.depth + 1 : 0,
      },
      select: { id: true },
    });

    return this.get(created.id);
  }

  async update(id: string, input: CategoryPatchInput): Promise<CategoryNode> {
    const current = await this.load(id);
    if (input.slug !== undefined && input.slug !== current.slug) {
      await this.assertSlugFree(input.slug, id);
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.CategoryUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name as Prisma.InputJsonValue;
      if (input.description !== undefined) {
        data.description = input.description as Prisma.InputJsonValue;
      }
      if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle as Prisma.InputJsonValue;
      if (input.seoDescription !== undefined) {
        data.seoDescription = input.seoDescription as Prisma.InputJsonValue;
      }
      if (input.mediaId !== undefined) data.mediaId = input.mediaId;
      if (input.position !== undefined) data.position = input.position;
      if (input.published !== undefined) data.published = input.published;

      if (input.slug !== undefined && input.slug !== current.slug) {
        data.slug = input.slug;
        const parent = current.parentId ? await this.load(current.parentId, tx) : null;
        data.path = pathFor(parent, input.slug);
      }

      await tx.category.update({ where: { id }, data });

      // A renamed slug changes the path of every descendant, since the path is built
      // from ancestor slugs.
      if (data.path) await this.rewriteSubtree(tx, id);
    });

    return this.get(id);
  }

  /** Drag-and-drop: a new parent and a new index among its siblings. */
  async move(id: string, input: CategoryMoveInput): Promise<CategoryNode[]> {
    const node = await this.load(id);

    if (input.parentId === id) {
      throw new BadRequestException({
        code: 'CATEGORY_CYCLE',
        message: CATALOG_ERRORS.CATEGORY_CYCLE,
      });
    }

    if (input.parentId) {
      const target = await this.load(input.parentId);
      // The path already encodes ancestry, so a cycle is a prefix test rather than a
      // walk up the tree.
      if (target.path.startsWith(node.path)) {
        throw new BadRequestException({
          code: 'CATEGORY_CYCLE',
          message: CATALOG_ERRORS.CATEGORY_CYCLE,
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const parent = input.parentId ? await this.load(input.parentId, tx) : null;

      await tx.category.update({
        where: { id },
        data: {
          parentId: parent?.id ?? null,
          depth: parent ? parent.depth + 1 : 0,
          path: pathFor(parent, node.slug),
          position: input.position,
        },
      });

      await this.rewriteSubtree(tx, id);
      await this.compactSiblings(tx, node.parentId);
      if (node.parentId !== (parent?.id ?? null)) {
        await this.compactSiblings(tx, parent?.id ?? null, id, input.position);
      }
    });

    return this.tree();
  }

  /** One write for a whole reordered tree, which is what a drag session produces. */
  async reorder(input: CategoryReorderInput): Promise<CategoryNode[]> {
    await this.prisma.$transaction(async (tx) => {
      for (const item of input.items) {
        const node = await this.load(item.id, tx);
        const parent = item.parentId ? await this.load(item.parentId, tx) : null;

        if (parent && parent.path.startsWith(node.path)) {
          throw new BadRequestException({
            code: 'CATEGORY_CYCLE',
            message: CATALOG_ERRORS.CATEGORY_CYCLE,
          });
        }

        await tx.category.update({
          where: { id: item.id },
          data: {
            parentId: parent?.id ?? null,
            depth: parent ? parent.depth + 1 : 0,
            path: pathFor(parent, node.slug),
            position: item.position,
          },
        });
      }

      // Children were repositioned above; their descendants still carry the old paths.
      for (const item of input.items) await this.rewriteSubtree(tx, item.id);
    });

    return this.tree();
  }

  /**
   * Deleting is refused while the category still has children or products. Silently
   * re-parenting someone's catalogue is not a recovery an operator can undo.
   */
  async remove(id: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { children: true, products: true } } },
    });
    if (!category) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That category does not exist' });
    }
    if (category._count.children > 0) {
      throw new ConflictException({
        code: 'CATEGORY_HAS_CHILDREN',
        message: CATALOG_ERRORS.CATEGORY_HAS_CHILDREN,
      });
    }
    if (category._count.products > 0) {
      throw new ConflictException({
        code: 'CATEGORY_IN_USE',
        message: `${category._count.products} products are still in this category`,
        details: { productCount: category._count.products },
      });
    }

    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // --- internals ------------------------------------------------------------

  /**
   * Rewrites `path` and `depth` for everything below a node, breadth-first. Each level
   * reads its parents' freshly written paths, so one pass per level is enough.
   */
  private async rewriteSubtree(tx: Prisma.TransactionClient, rootId: string): Promise<void> {
    let frontier = [rootId];

    for (let guard = 0; guard < 12 && frontier.length > 0; guard += 1) {
      const parents = await tx.category.findMany({
        where: { id: { in: frontier } },
        select: { id: true, path: true, depth: true },
      });
      const byId = new Map(parents.map((parent) => [parent.id, parent]));

      const children = await tx.category.findMany({
        where: { parentId: { in: frontier }, deletedAt: null },
        select: { id: true, slug: true, parentId: true },
      });

      for (const child of children) {
        const parent = child.parentId ? byId.get(child.parentId) : undefined;
        if (!parent) continue;
        await tx.category.update({
          where: { id: child.id },
          data: {
            path: `${parent.path}${child.slug}/`,
            depth: parent.depth + 1,
          },
        });
      }

      frontier = children.map((child) => child.id);
    }
  }

  /** Renumbers a sibling group 0..n so positions stay dense after a move. */
  private async compactSiblings(
    tx: Prisma.TransactionClient,
    parentId: string | null,
    insertedId?: string,
    insertedAt?: number,
  ): Promise<void> {
    const siblings = await tx.category.findMany({
      where: { parentId, deletedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });

    const ordered = siblings.map((sibling) => sibling.id);
    if (insertedId && insertedAt !== undefined) {
      const without = ordered.filter((id) => id !== insertedId);
      without.splice(Math.min(insertedAt, without.length), 0, insertedId);
      ordered.splice(0, ordered.length, ...without);
    }

    for (const [position, id] of ordered.entries()) {
      await tx.category.update({ where: { id }, data: { position } });
    }
  }

  private async load(id: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const category = await db.category.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, slug: true, path: true, depth: true, parentId: true },
    });
    if (!category) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'That category does not exist' });
    }
    return category;
  }

  private async nextPosition(parentId: string | null): Promise<number> {
    const last = await this.prisma.category.findFirst({
      where: { parentId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? -1) + 1;
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.category.findFirst({
      where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: CATALOG_ERRORS.SLUG_TAKEN,
        details: { slug },
      });
    }
  }
}

/** `/caps/` under a parent at `/`, `/caps/truckers/` under `/caps/`. */
export function pathFor(parent: { path: string } | null, slug: string): string {
  return `${parent?.path ?? '/'}${slug}/`;
}

function findNode(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inChildren = findNode(node.children, id);
    if (inChildren) return inChildren;
  }
  return null;
}

export const __categoryInternals = { pathFor, findNode };
