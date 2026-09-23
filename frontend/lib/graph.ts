import type { Cluster, GraphData, GraphLink, GraphNode } from "./types";

/**
 * react-force-graph после старта симуляции подменяет link.source / link.target
 * объектами узлов. Везде, где нужен gid, идём через этот хелпер.
 */
export function endpointId(endpoint: unknown): number {
  if (typeof endpoint === "number") return endpoint;
  if (typeof endpoint === "object" && endpoint !== null) {
    const id = (endpoint as { id?: unknown }).id;
    if (typeof id === "number") return id;
    if (typeof id === "string") return Number(id);
  }
  return Number(endpoint);
}

export function linkEnds(link: GraphLink): [number, number] {
  return [endpointId(link.source), endpointId(link.target)];
}

export interface Neighbor {
  gid: number;
  sum_kzt: number;
  n_tx: number;
}

export interface NeighborEntry {
  in: Neighbor[];
  out: Neighbor[];
}

export interface GraphStats {
  nodeCount: number;
  linkCount: number;
  turnover: number;
  cutoffCount: number;
  seedCount: number;
  maxDepth: number;
}

export interface GraphIndex {
  nodeById: Map<number, GraphNode>;
  clusterById: Map<number, Cluster>;
  /** gid → отправители и получатели, отсортированные по сумме. */
  neighbors: Map<number, NeighborEntry>;
  stats: GraphStats;
  topGids: Set<number>;
  depths: number[];
}

const EMPTY_ENTRY: NeighborEntry = { in: [], out: [] };

/** Считается один раз при загрузке данных, а не на каждый клик. */
export function buildIndex(data: GraphData): GraphIndex {
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const neighbors = new Map<number, NeighborEntry>();

  const entry = (gid: number): NeighborEntry => {
    let found = neighbors.get(gid);
    if (!found) {
      found = { in: [], out: [] };
      neighbors.set(gid, found);
    }
    return found;
  };

  let turnover = 0;
  data.links.forEach((link) => {
    const [source, target] = linkEnds(link);
    turnover += link.sum_kzt;
    entry(source).out.push({ gid: target, sum_kzt: link.sum_kzt, n_tx: link.n_tx });
    entry(target).in.push({ gid: source, sum_kzt: link.sum_kzt, n_tx: link.n_tx });
  });

  neighbors.forEach((value) => {
    value.in.sort((a, b) => b.sum_kzt - a.sum_kzt);
    value.out.sort((a, b) => b.sum_kzt - a.sum_kzt);
  });

  const depths = Array.from(new Set(data.nodes.map((n) => n.depth))).sort((a, b) => a - b);

  return {
    nodeById,
    clusterById: new Map(data.clusters.map((c) => [c.cluster_id, c])),
    neighbors,
    stats: {
      nodeCount: data.nodes.length,
      linkCount: data.links.length,
      turnover,
      cutoffCount: data.nodes.filter((n) => n.is_cutoff).length,
      seedCount: data.nodes.filter((n) => n.is_seed).length,
      maxDepth: depths.length > 0 ? depths[depths.length - 1] : 0,
    },
    topGids: new Set(data.top.slice(0, 20).map((t) => t.gid)),
    depths,
  };
}

/** Сравнение с текстовым gid не даёт округлённому Number открыть другой узел. */
export function findNodeByGid(index: GraphIndex, text: string): GraphNode | undefined {
  const canonical = text.trim().replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(canonical)) return undefined;
  const node = index.nodeById.get(Number(canonical));
  return node && String(node.id) === canonical ? node : undefined;
}

export function neighborsOf(index: GraphIndex, gid: number): NeighborEntry {
  return index.neighbors.get(gid) ?? EMPTY_ENTRY;
}

/** Множество gid, связанных с узлом в обе стороны, включая сам узел. */
export function connectedGids(index: GraphIndex, gid: number): Set<number> {
  const entry = neighborsOf(index, gid);
  const set = new Set<number>([gid]);
  entry.in.forEach((n) => set.add(n.gid));
  entry.out.forEach((n) => set.add(n.gid));
  return set;
}

/** Доля пропуска: сколько из полученного узел отдал дальше. */
export function passThrough(node: GraphNode): number {
  return node.sum_in > 0 ? node.sum_out / node.sum_in : 0;
}
