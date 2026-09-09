import type { CategoryNode } from '@jecks/shared';

/**
 * Depth-first walk of the category tree, in the order it is drawn.
 *
 * Both the tree editor and every category picker need the same flat sequence — one to
 * render rows, the other to indent option labels — so the traversal lives here rather
 * than being written twice with subtly different ordering.
 */
export function flattenTree(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (list: CategoryNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Every id at or below a node — what a drag must not be allowed to drop into. */
export function subtreeIds(node: CategoryNode): Set<string> {
  const ids = new Set<string>();
  const walk = (current: CategoryNode) => {
    ids.add(current.id);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return ids;
}

export function findNode(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Products directly on a node plus everything beneath it. */
export function subtreeProductCount(node: CategoryNode): number {
  return node.children.reduce((sum, child) => sum + subtreeProductCount(child), node.productCount);
}
