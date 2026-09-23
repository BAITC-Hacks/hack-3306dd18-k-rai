import { makeRandom, type Random } from "./rng";
import { formatKzt, formatPercent } from "./format";
import type {
  AgentStep,
  AskRequest,
  AskResponse,
  Cluster,
  GraphData,
  GraphLink,
  GraphNode,
  Role,
  TopItem,
} from "./types";

/**
 * Детерминированный генератор данных, структурно похожих на реальную выгрузку.
 * Топология строится явно (консолидаторы, транзитные цепочки, распределители,
 * координатор), суммы распространяются по слоям, а роли и приоритеты затем
 * ВЫЧИСЛЯЮТСЯ из получившихся метрик — никаких зашитых списков gid.
 */

const SEED = 42;

// Пропорции слоёв повторяют реальные (81 / 472 / 462 / 789 / 444), масштаб ~1:5,4.
const LAYER_SIZES = [30, 84, 82, 140, 79];
const N_CLUSTERS = 6;
const SEEDS_WITHOUT_OUTGOING = 8;

interface Draft {
  id: number;
  depth: number;
  is_seed: boolean;
  seed_group: number; // для seed — их группа, дальше вычисляется по потокам
  /** Задуманная архетипическая роль — влияет только на долю пропуска денег. */
  archetype: "seed" | "consolidator" | "transit" | "distributor" | "coordinator" | "plain" | "sink";
  out: number[]; // id получателей
  in: number[]; // id отправителей
}

interface EdgeDraft {
  source: number;
  target: number;
  sum_kzt: number;
  n_tx: number;
  weight: number;
}

const PASS_RATIO: Record<Draft["archetype"], [number, number]> = {
  seed: [1, 1],
  consolidator: [0.03, 0.22],
  transit: [0.86, 1.0],
  distributor: [0.78, 0.94],
  coordinator: [0.04, 0.18],
  plain: [0.2, 1.0],
  sink: [0, 0],
};

function buildTopology(rnd: Random) {
  const layers: Draft[][] = [];
  const byId = new Map<number, Draft>();
  let gid = 240137;

  for (let depth = 0; depth < LAYER_SIZES.length; depth += 1) {
    const layer: Draft[] = [];
    for (let i = 0; i < LAYER_SIZES[depth]; i += 1) {
      gid += rnd.int(1, 37);
      const node: Draft = {
        id: gid,
        depth,
        is_seed: depth === 0,
        // Первые узлы раскладываются по группам поровну, остальные — случайно,
        // чтобы кластеры получились разного размера, как в реальной выгрузке.
        seed_group: depth === 0 ? (i < N_CLUSTERS * 2 ? i % N_CLUSTERS : rnd.int(0, N_CLUSTERS - 1)) : -1,
        archetype: depth === 0 ? "seed" : "plain",
        out: [],
        in: [],
      };
      layer.push(node);
      byId.set(node.id, node);
    }
    layers.push(layer);
  }

  const edges = new Map<string, EdgeDraft>();
  const link = (src: Draft, dst: Draft, weight: number) => {
    const key = `${src.id}->${dst.id}`;
    const existing = edges.get(key);
    if (existing) {
      existing.weight += weight;
      return;
    }
    edges.set(key, { source: src.id, target: dst.id, sum_kzt: 0, n_tx: 0, weight });
    src.out.push(dst.id);
    dst.in.push(src.id);
  };

  const [seeds, d1, d2, d3, d4] = layers;

  // 8 seed-клиентов без исходящих переводов — как в реальных данных
  // (19 из 81 seed вообще отсутствуют в рёбрах). Помечаем их как sink,
  // чтобы они не попали и в доборные рёбра ниже.
  const activeSeeds = seeds.slice(0, seeds.length - SEEDS_WITHOUT_OUTGOING);
  seeds.slice(seeds.length - SEEDS_WITHOUT_OUTGOING).forEach((s) => {
    s.archetype = "sink";
  });

  // Три точки консолидации на 1-м колене: 8–15 разных отправителей,
  // преимущественно из «своей» группы seed.
  const consolidators = [d1[0], d1[1], d1[2]];
  consolidators.forEach((node, i) => {
    node.archetype = "consolidator";
    const own = activeSeeds.filter((s) => s.seed_group === i || s.seed_group === i + 3);
    const others = activeSeeds.filter((s) => !own.includes(s));
    const senders = [
      ...rnd.sample(own, Math.min(own.length, rnd.int(6, 9))),
      ...rnd.sample(others, rnd.int(3, 6)),
    ];
    const unique = Array.from(new Set(senders)).slice(0, 15);
    unique.forEach((s) => link(s, node, rnd.float(0.5, 1.5)));
  });

  // Остальные исходящие seed-клиентов — в периферию 1-го колена.
  // Курьер, который уже платит сборщику, чаще всего больше никому не платит:
  // именно поэтому изъятие точки консолидации отрезает его ветку от сети.
  activeSeeds.forEach((s) => {
    const feedsCollector = s.out.length > 0;
    const extra = feedsCollector ? (rnd.next() < 0.3 ? 1 : 0) : rnd.int(1, 2);
    if (extra === 0) return;
    rnd.sample(d1.slice(3), extra).forEach((t) => link(s, t, rnd.float(0.4, 1.2)));
  });

  // Транзитные цепочки: консолидатор → транзит (2-е колено) → 3-е колено.
  const transits: Draft[] = [];
  consolidators.forEach((c) => {
    const chain = rnd.sample(d2.slice(2), rnd.int(3, 5));
    chain.forEach((t) => {
      t.archetype = "transit";
      transits.push(t);
      link(c, t, rnd.float(0.8, 1.4));
    });
  });

  // Координатор на 3-м колене: в него стекаются цепочки от всех трёх консолидаторов,
  // то есть от цепочек более чем трёх разных seed-клиентов.
  const coordinator = d3[0];
  coordinator.archetype = "coordinator";
  consolidators.forEach((c, i) => {
    const own = transits.filter((t) => t.in.includes(c.id));
    rnd.sample(own, Math.min(own.length, i === 0 ? 2 : 1)).forEach((t) => {
      link(t, coordinator, rnd.float(1.2, 2.0));
    });
  });

  // Два распределителя: веером на 25–40 получателей.
  const distributorA = d2[0]; // 2-е колено → получатели на 3-м
  distributorA.archetype = "distributor";
  rnd.sample(d1.slice(3), rnd.int(3, 5)).forEach((s) => link(s, distributorA, rnd.float(0.9, 1.6)));
  rnd.sample(d3.slice(1), rnd.int(25, 40)).forEach((t) => link(distributorA, t, rnd.float(0.6, 1.4)));

  const distributorB = d3[1]; // 3-е колено → получатели на 4-м (обрыв)
  distributorB.archetype = "distributor";
  rnd.sample(transits, rnd.int(2, 4)).forEach((s) => link(s, distributorB, rnd.float(1.0, 1.8)));
  rnd.sample(d4, rnd.int(25, 40)).forEach((t) => link(distributorB, t, rnd.float(0.5, 1.3)));

  // Настоящие конечные получатели: узлы 2-го и 3-го колена без исходящих
  // (обрыв выгрузки их не касается — она обрывается только на 4-м колене).
  const sinkPool = [...d2.slice(6), ...d3.slice(2)];
  rnd.sample(sinkPool, Math.round(sinkPool.length * 0.12)).forEach((n) => {
    if (n.archetype === "plain") n.archetype = "sink";
  });

  // Все узлы 4-го колена — обрыв выгрузки, исходящих нет по определению.
  d4.forEach((n) => {
    n.archetype = "sink";
  });

  // Фоновые переводы: каждый узел, у которого есть исходящие, отдаёт дальше.
  const fill = (from: Draft[], to: Draft[], maxTargets: number) => {
    from.forEach((n) => {
      if (n.archetype === "sink") return;
      const need = n.out.length === 0 ? rnd.int(1, maxTargets) : rnd.int(0, maxTargets - 1);
      rnd.sample(to, need).forEach((t) => link(n, t, rnd.float(0.4, 1.3)));
    });
  };
  fill(d1, d2, 3);
  fill(d2, d3, 3);
  fill(d3, d4, 3);

  // Каждый узел ниже seed должен иметь хотя бы один входящий перевод,
  // иначе его depth перестанет соответствовать данным.
  for (let depth = 1; depth < layers.length; depth += 1) {
    const donors = layers[depth - 1].filter((n) => n.archetype !== "sink");
    layers[depth].forEach((n) => {
      if (n.in.length > 0) return;
      const donor = donors.length > 0 ? rnd.pick(donors) : layers[depth - 1][0];
      link(donor, n, rnd.float(0.4, 1.0));
    });
  }

  return { layers, byId, edges: Array.from(edges.values()) };
}

/** Раздаём деньги по слоям: seed задают бюджет, дальше узел пропускает свою долю. */
function propagateMoney(rnd: Random, layers: Draft[][], edges: EdgeDraft[]) {
  const outgoing = new Map<number, EdgeDraft[]>();
  edges.forEach((e) => {
    const list = outgoing.get(e.source);
    if (list) list.push(e);
    else outgoing.set(e.source, [e]);
  });

  const received = new Map<number, number>();

  layers.forEach((layer, depth) => {
    layer.forEach((node) => {
      const inSum = depth === 0 ? rnd.float(600_000, 9_000_000) : (received.get(node.id) ?? 0);
      const [lo, hi] = PASS_RATIO[node.archetype];
      const outSum = depth === 0 ? inSum : inSum * rnd.float(lo, hi);
      const outEdges = outgoing.get(node.id) ?? [];
      if (outEdges.length === 0 || outSum <= 0) return;

      const total = outEdges.reduce((acc, e) => acc + e.weight, 0);
      outEdges.forEach((e) => {
        const share = Math.round((outSum * e.weight) / total);
        if (share < 5_000) return; // порог выгрузки: переводы < 5 000 ₸ в данные не попали
        e.sum_kzt = share;
        e.n_tx = 1 + Math.floor(share / 850_000) + rnd.int(0, 3);
        received.set(e.target, (received.get(e.target) ?? 0) + share);
      });
    });
  });

  // Рёбра, не набравшие порог 5 000 ₸, из выгрузки выпадают.
  return edges.filter((e) => e.sum_kzt >= 5_000);
}

interface Metrics {
  in_senders: number;
  out_receivers: number;
  sum_in: number;
  sum_out: number;
  seed_reach: number;
}

function computeMetrics(drafts: Draft[], edges: EdgeDraft[]): Map<number, Metrics> {
  const metrics = new Map<number, Metrics>();
  drafts.forEach((d) => {
    metrics.set(d.id, { in_senders: 0, out_receivers: 0, sum_in: 0, sum_out: 0, seed_reach: 0 });
  });

  const inSet = new Map<number, Set<number>>();
  const outSet = new Map<number, Set<number>>();
  const push = (map: Map<number, Set<number>>, key: number, value: number) => {
    const set = map.get(key);
    if (set) set.add(value);
    else map.set(key, new Set([value]));
  };

  edges.forEach((e) => {
    push(inSet, e.target, e.source);
    push(outSet, e.source, e.target);
    const src = metrics.get(e.source);
    const dst = metrics.get(e.target);
    if (src) src.sum_out += e.sum_kzt;
    if (dst) dst.sum_in += e.sum_kzt;
  });

  metrics.forEach((m, id) => {
    m.in_senders = inSet.get(id)?.size ?? 0;
    m.out_receivers = outSet.get(id)?.size ?? 0;
  });

  // Сколько разных seed-клиентов достигают узла вниз по течению.
  const adjacency = new Map<number, number[]>();
  edges.forEach((e) => {
    const list = adjacency.get(e.source);
    if (list) list.push(e.target);
    else adjacency.set(e.source, [e.target]);
  });
  const reach = new Map<number, Set<number>>();
  drafts
    .filter((d) => d.is_seed)
    .forEach((seed) => {
      const queue = [seed.id];
      const visited = new Set<number>([seed.id]);
      while (queue.length > 0) {
        const current = queue.shift() as number;
        (adjacency.get(current) ?? []).forEach((next) => {
          if (visited.has(next)) return;
          visited.add(next);
          push(reach, next, seed.id);
          queue.push(next);
        });
      }
    });
  metrics.forEach((m, id) => {
    m.seed_reach = reach.get(id)?.size ?? 0;
  });

  return metrics;
}

/**
 * Правила присвоения роли. Пороги подобраны так, чтобы каждая роль имела
 * формальный критерий, который можно назвать вслух на защите.
 */
function classify(
  draft: Draft,
  m: Metrics,
  is_cutoff: boolean,
  bigInflow: number,
): { role: Role; role_score: number; evidence: string } {
  const pass = m.sum_in > 0 ? m.sum_out / m.sum_in : 0;
  const money = formatKzt(m.sum_in);

  // Узлы на обрыве судим только по входящим: их исходящие переводы
  // не «отсутствуют», а лежат за границей выгрузки. Признак «мало отдаёт»
  // к ним неприменим, поэтому роли terminal и transit для них закрыты.
  if (is_cutoff) {
    if (m.in_senders >= 8) {
      return {
        role: "consolidator",
        role_score: clamp(0.45 + (m.in_senders - 8) * 0.03, 0.45, 0.75),
        evidence: `Получает ${money} от ${m.in_senders} разных плательщиков. Выгрузка обрывается на 4-м колене, исходящие неизвестны — признаки консолидации по входящим.`,
      };
    }
    return {
      role: "peripheral",
      role_score: 0.4,
      evidence: `4-е колено, выгрузка обрывается: пришло ${money} от ${m.in_senders}. Куда деньги ушли дальше — неизвестно, конечным получателем не считается.`,
    };
  }

  if (m.in_senders >= 8 && pass < 0.5) {
    return {
      role: "consolidator",
      role_score: clamp(0.6 + (m.in_senders - 8) * 0.03 + (0.5 - pass) * 0.4, 0.6, 0.97),
      evidence: `Получает ${money} от ${m.in_senders} разных плательщиков, отдаёт дальше ${formatPercent(pass)} полученного — признаки консолидации средств.`,
    };
  }

  if (m.out_receivers >= 20) {
    return {
      role: "distributor",
      role_score: clamp(0.6 + (m.out_receivers - 20) * 0.01, 0.6, 0.95),
      evidence: `Веерно распределяет ${formatKzt(m.sum_out)} на ${m.out_receivers} получателей, средний перевод ${formatKzt(m.sum_out / Math.max(1, m.out_receivers))}.`,
    };
  }

  // Порог по объёму — не абсолютная цифра, а верхние 5% графа по входящим.
  if (m.seed_reach >= 3 && m.in_senders >= 3 && pass < 0.35 && m.sum_in >= bigInflow) {
    return {
      role: "coordinator",
      role_score: clamp(0.55 + m.seed_reach * 0.02 + (0.35 - pass) * 0.5, 0.55, 0.93),
      evidence: `Сюда сходятся цепочки от ${m.seed_reach} seed-клиентов через ${m.in_senders} плательщиков; удерживает ${formatPercent(1 - pass)} из ${money} — кандидат в координирующий узел.`,
    };
  }

  if (m.sum_in > 0 && m.out_receivers >= 1 && pass >= 0.8 && pass <= 1.2) {
    return {
      role: "transit",
      role_score: clamp(0.5 + (1 - Math.abs(1 - pass)) * 0.45, 0.5, 0.95),
      evidence: `Пропускает ${formatPercent(pass)} полученного: пришло ${money} от ${m.in_senders}, ушло ${formatKzt(m.sum_out)} к ${m.out_receivers} — признаки транзита.`,
    };
  }

  if (!is_cutoff && m.out_receivers === 0 && m.sum_in > 0) {
    return {
      role: "terminal",
      role_score: clamp(0.6 + Math.min(m.in_senders, 6) * 0.05, 0.6, 0.92),
      evidence: `Пришло ${money} от ${m.in_senders}, исходящих переводов нет, узел не на 4-м колене — деньги остались на счёте.`,
    };
  }

  if (m.sum_in === 0 && m.sum_out === 0) {
    return {
      role: "peripheral",
      role_score: 0.35,
      evidence: draft.is_seed
        ? "Seed-клиент из запроса правоохранительных органов, исходящих переводов свыше 5 000 ₸ в выгрузке нет."
        : "Переводов в выгрузке нет, признаков роли не выявлено.",
    };
  }

  return {
    role: "peripheral",
    role_score: 0.35,
    evidence: `Пришло ${money} от ${m.in_senders}, ушло ${formatKzt(m.sum_out)} к ${m.out_receivers} — выраженных признаков роли не выявлено.`,
  };
}

const ROLE_WEIGHT: Record<Role, number> = {
  coordinator: 1,
  consolidator: 0.9,
  distributor: 0.7,
  transit: 0.5,
  terminal: 0.35,
  peripheral: 0.1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Перцентильная нормировка: устойчива к выбросам сумм. */
function percentileRanks(values: number[]): number[] {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  sorted.forEach((item, position) => {
    ranks[item.i] = values.length > 1 ? position / (values.length - 1) : 0;
  });
  return ranks;
}

function assignClusters(layers: Draft[][], edges: EdgeDraft[]): Map<number, number> {
  const cluster = new Map<number, number>();
  layers[0].forEach((seed) => cluster.set(seed.id, seed.seed_group));

  const incoming = new Map<number, EdgeDraft[]>();
  edges.forEach((e) => {
    const list = incoming.get(e.target);
    if (list) list.push(e);
    else incoming.set(e.target, [e]);
  });

  for (let depth = 1; depth < layers.length; depth += 1) {
    layers[depth].forEach((node) => {
      const weights = new Map<number, number>();
      (incoming.get(node.id) ?? []).forEach((e) => {
        const c = cluster.get(e.source);
        if (c === undefined) return;
        weights.set(c, (weights.get(c) ?? 0) + e.sum_kzt);
      });
      let best = 0;
      let bestWeight = -1;
      weights.forEach((w, c) => {
        if (w > bestWeight) {
          bestWeight = w;
          best = c;
        }
      });
      cluster.set(node.id, best);
    });
  }
  return cluster;
}

function buildClusters(nodes: GraphNode[], links: GraphLink[]): Cluster[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const grouped = new Map<number, GraphNode[]>();
  nodes.forEach((n) => {
    const list = grouped.get(n.cluster_id);
    if (list) list.push(n);
    else grouped.set(n.cluster_id, [n]);
  });

  const internal = new Map<number, number>();
  links.forEach((l) => {
    const a = byId.get(l.source);
    const b = byId.get(l.target);
    if (!a || !b || a.cluster_id !== b.cluster_id) return;
    internal.set(a.cluster_id, (internal.get(a.cluster_id) ?? 0) + l.sum_kzt);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([cluster_id, members]) => {
      const ranked = members.slice().sort((a, b) => b.priority_score - a.priority_score);
      const top = ranked.slice(0, 5);
      const lead = ranked[0];
      const nSeed = members.filter((n) => n.is_seed).length;
      const sumInternal = internal.get(cluster_id) ?? 0;
      return {
        cluster_id,
        n_nodes: members.length,
        n_seed: nSeed,
        sum_kzt_internal: sumInternal,
        top_gids: top.map((n) => n.id),
        hypothesis: clusterHypothesis(lead, members.length, nSeed, sumInternal),
      };
    });
}

function clusterHypothesis(lead: GraphNode, nNodes: number, nSeed: number, sumInternal: number): string {
  const base = `${nNodes} узлов, ${nSeed} из списка правоохранительных органов, внутренний оборот ${formatKzt(sumInternal)}.`;
  switch (lead.role) {
    case "consolidator":
      return `${base} Потоки сходятся на узле ${lead.id} — вероятная ветка сбора средств с курьеров.`;
    case "coordinator":
      return `${base} Ключевой узел ${lead.id} собирает цепочки от нескольких seed — вероятный управляющий контур.`;
    case "distributor":
      return `${base} Во главе узел ${lead.id} с веерной рассылкой — вероятная точка раздачи средств.`;
    case "transit":
      return `${base} Преобладают транзитные узлы вокруг ${lead.id} — вероятный канал перегона средств.`;
    default:
      return `${base} Выраженного центра нет, ветка требует проверки вручную.`;
  }
}

function buildTop(nodes: GraphNode[]): TopItem[] {
  return nodes
    .slice()
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 20)
    .map((node, index) => ({
      rank: index + 1,
      gid: node.id,
      role: node.role,
      priority_score: node.priority_score,
      why: whyText(node),
    }));
}

function whyText(node: GraphNode): string {
  const pass = node.sum_in > 0 ? node.sum_out / node.sum_in : 0;
  switch (node.role) {
    case "consolidator":
      return `${node.in_senders} плательщиков, получено ${formatKzt(node.sum_in)}, отдано дальше ${formatPercent(pass)} — точка концентрации средств на ${node.depth}-м колене.`;
    case "coordinator":
      return `Сходятся цепочки нескольких seed-клиентов: ${node.in_senders} плательщиков, ${formatKzt(node.sum_in)}, удерживает ${formatPercent(1 - pass)}.`;
    case "distributor":
      return `Раздаёт ${formatKzt(node.sum_out)} на ${node.out_receivers} получателей — узкое место при разрыве цепочки.`;
    case "transit":
      return `Пропускает ${formatPercent(pass)} из ${formatKzt(node.sum_in)} — через узел проходит поток, но не оседает.`;
    case "terminal":
      return `Получил ${formatKzt(node.sum_in)} от ${node.in_senders} и не отправил дальше; обрыва выгрузки нет — деньги остались.`;
    default:
      return `Получил ${formatKzt(node.sum_in)} от ${node.in_senders}, отправил ${formatKzt(node.sum_out)} к ${node.out_receivers}.`;
  }
}

let cached: GraphData | null = null;

export function generateMockGraph(): GraphData {
  if (cached) return cached;

  const rnd = makeRandom(SEED);
  const { layers, edges: rawEdges } = buildTopology(rnd);
  const edges = propagateMoney(rnd, layers, rawEdges);
  const drafts = layers.flat();
  const metrics = computeMetrics(drafts, edges);
  const clusterOf = assignClusters(layers, edges);

  // 95-й перцентиль входящих — порог «крупного» узла для правила координатора.
  const inflows = drafts
    .map((d) => (metrics.get(d.id) as Metrics).sum_in)
    .sort((a, b) => a - b);
  const bigInflow = inflows[Math.floor(inflows.length * 0.95)] ?? 0;

  const base = drafts.map((draft) => {
    const m = metrics.get(draft.id) as Metrics;
    const is_cutoff = draft.depth === 4 && m.out_receivers === 0;
    const { role, role_score, evidence } = classify(draft, m, is_cutoff, bigInflow);
    return { draft, m, is_cutoff, role, role_score, evidence };
  });

  const rankSumIn = percentileRanks(base.map((b) => b.m.sum_in));
  const rankSumOut = percentileRanks(base.map((b) => b.m.sum_out));
  const rankSenders = percentileRanks(base.map((b) => b.m.in_senders));
  const rankReach = percentileRanks(base.map((b) => b.m.seed_reach));

  const rawPriority = base.map((b, i) =>
    0.3 * rankSumIn[i] +
    0.15 * rankSumOut[i] +
    0.22 * rankSenders[i] +
    0.15 * rankReach[i] +
    0.18 * ROLE_WEIGHT[b.role],
  );
  const maxPriority = Math.max(...rawPriority, 1e-6);

  const nodes: GraphNode[] = base.map((b, i) => ({
    id: b.draft.id,
    role: b.role,
    role_score: Number(b.role_score.toFixed(2)),
    cluster_id: clusterOf.get(b.draft.id) ?? 0,
    priority_score: Number((rawPriority[i] / maxPriority).toFixed(4)),
    depth: b.draft.depth,
    is_seed: b.draft.is_seed,
    in_senders: b.m.in_senders,
    out_receivers: b.m.out_receivers,
    sum_in: b.m.sum_in,
    sum_out: b.m.sum_out,
    is_cutoff: b.is_cutoff,
    evidence: b.evidence.slice(0, 200),
  }));

  const links: GraphLink[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    sum_kzt: e.sum_kzt,
    n_tx: e.n_tx,
  }));

  cached = {
    nodes,
    links,
    clusters: buildClusters(nodes, links),
    top: buildTop(nodes),
  };
  return cached;
}

/** Мок агента: 1,5 секунды «размышлений», затем правдоподобные шаги по реальным данным. */
export async function mockAsk(request: AskRequest): Promise<AskResponse> {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const graph = generateMockGraph();
  const selected = request.selected_gids ?? [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // Берём узел из вопроса или из выделения, иначе — первый в топе.
  const mentioned = request.question.match(/\d{5,}/)?.[0];
  const anchor =
    (mentioned && byId.get(Number(mentioned))) ||
    (selected.length > 0 ? byId.get(selected[0]) : undefined) ||
    byId.get(graph.top[0].gid);

  if (!anchor) {
    return {
      answer: "Не нашёл в графе узлов, о которых идёт речь. Уточните gid или выделите узлы на схеме.",
      steps: [],
      highlight_gids: [],
    };
  }

  // Ищем ближайшего консолидатора вниз по течению от выделенных узлов.
  const outgoing = new Map<number, number[]>();
  graph.links.forEach((l) => {
    const list = outgoing.get(l.source);
    if (list) list.push(l.target);
    else outgoing.set(l.source, [l.target]);
  });

  const roots = selected.length > 0 ? selected : [anchor.id];
  const visited = new Set<number>(roots);
  const queue = [...roots];
  let collector: typeof anchor | undefined;
  while (queue.length > 0 && !collector) {
    const current = queue.shift() as number;
    for (const next of outgoing.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      const node = byId.get(next);
      if (node && (node.role === "consolidator" || node.role === "coordinator")) {
        collector = node;
        break;
      }
      queue.push(next);
    }
  }

  const target = collector ?? anchor;
  const senders = graph.links
    .filter((l) => l.target === target.id)
    .sort((a, b) => b.sum_kzt - a.sum_kzt)
    .slice(0, 8)
    .map((l) => l.source);

  const steps: AgentStep[] = [
    {
      tool: "get_node",
      args: { gid: target.id },
      summary: `gid ${target.id}: роль присвоена по правилу, уверенность ${Math.round(target.role_score * 100)}%.`,
    },
    {
      tool: "get_senders",
      args: { gid: target.id, limit: 10 },
      summary: `${target.in_senders} уникальных плательщиков на общую сумму ${formatKzt(target.sum_in)}.`,
    },
    {
      tool: "common_receivers",
      args: { gids: roots.slice(0, 5) },
      summary:
        roots.length > 1
          ? `Проверил, куда сходятся потоки ${roots.length} выделенных узлов — общий получатель найден.`
          : "Проверил, есть ли у отправителей общие получатели помимо этого узла.",
    },
    {
      tool: "cluster_summary",
      args: { cluster_id: target.cluster_id },
      summary: `Кластер ${target.cluster_id}: ${graph.clusters.find((c) => c.cluster_id === target.cluster_id)?.n_nodes ?? 0} узлов в ветке.`,
    },
  ];

  const pass = target.sum_in > 0 ? target.sum_out / target.sum_in : 0;
  // Ответ размечен так же, как отдаёт реальная модель, — markdown с переводами строк.
  const answer = [
    `Деньги сходятся на узле **${target.id}** — ${target.role === "coordinator" ? "признаки координирующего узла" : "признаки консолидации"}.`,
    "",
    "Что видно по данным:",
    `- получил **${formatKzt(target.sum_in)}** от ${target.in_senders} разных плательщиков;`,
    `- отдал дальше ${formatPercent(pass)} полученного;`,
    `- кластер ${target.cluster_id}.`,
    "",
    "Затронутые gid:",
    ...senders.slice(0, 5).map((gid) => `- ${gid}`),
    "",
    "Это гипотеза для проверки, а не вывод о виновности.",
  ].join("\n");

  return {
    answer,
    steps,
    highlight_gids: [target.id, ...senders],
    mode: "llm",
  };
}
