import { linkEnds } from "./graph";
import type { GraphLink, GraphNode } from "./types";

/**
 * Оценка устойчивости сети: что останется от графа, если изъять топ-N узлов.
 * Все цифры считаются здесь из данных — ничего захардкоженного.
 */

export interface NetworkState {
  /** Слабосвязные компоненты: направление рёбер игнорируется. */
  components: number;
  /** Число узлов в крупнейшей компоненте. */
  largestComponent: number;
  nodes: number;
  links: number;
  turnover: number;
}

class UnionFind {
  private parent = new Map<number, number>();
  private size = new Map<number, number>();

  add(id: number) {
    if (this.parent.has(id)) return;
    this.parent.set(id, id);
    this.size.set(id, 1);
  }

  find(id: number): number {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as number;
    }
    // Сжатие пути, чтобы повторные запросы были дешёвыми.
    let current = id;
    while (this.parent.get(current) !== root) {
      const next = this.parent.get(current) as number;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: number, b: number) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const sizeA = this.size.get(rootA) as number;
    const sizeB = this.size.get(rootB) as number;
    if (sizeA >= sizeB) {
      this.parent.set(rootB, rootA);
      this.size.set(rootA, sizeA + sizeB);
    } else {
      this.parent.set(rootA, rootB);
      this.size.set(rootB, sizeA + sizeB);
    }
  }

  /** [число компонент, размер крупнейшей] */
  summary(): [number, number] {
    const roots = new Set<number>();
    let largest = 0;
    this.parent.forEach((_, id) => {
      const root = this.find(id);
      roots.add(root);
      largest = Math.max(largest, this.size.get(root) as number);
    });
    return [roots.size, largest];
  }
}

/** Состояние сети без учёта изъятых узлов и инцидентных им рёбер. */
export function analyzeNetwork(
  nodes: GraphNode[],
  links: GraphLink[],
  removed: ReadonlySet<number> = new Set(),
): NetworkState {
  const uf = new UnionFind();
  let keptNodes = 0;

  nodes.forEach((node) => {
    if (removed.has(node.id)) return;
    uf.add(node.id);
    keptNodes += 1;
  });

  let keptLinks = 0;
  let turnover = 0;
  links.forEach((link) => {
    const [source, target] = linkEnds(link);
    if (removed.has(source) || removed.has(target)) return;
    uf.union(source, target);
    keptLinks += 1;
    turnover += link.sum_kzt;
  });

  const [components, largestComponent] = uf.summary();
  return { components, largestComponent, nodes: keptNodes, links: keptLinks, turnover };
}

/**
 * Доля оборота, прошедшая через изъятые узлы: сумма рёбер, где они источник
 * или получатель, делённая на общий оборот графа.
 */
export function removedTurnoverShare(links: GraphLink[], removed: ReadonlySet<number>): number {
  let total = 0;
  let touched = 0;
  links.forEach((link) => {
    const [source, target] = linkEnds(link);
    total += link.sum_kzt;
    if (removed.has(source) || removed.has(target)) touched += link.sum_kzt;
  });
  return total > 0 ? touched / total : 0;
}
