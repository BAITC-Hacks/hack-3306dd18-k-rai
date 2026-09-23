import { ROLE_ORDER } from "./roles";
import type { AskResponse, Cluster, GraphData, GraphLink, GraphNode, Role, TopItem } from "./types";

/**
 * Любые данные от бэка проходят здесь: переименованное или отсутствующее поле
 * не должно ронять интерфейс — вместо этого подставляется безопасное значение.
 */

const ROLE_SET = new Set<string>(ROLE_ORDER);

type Unknown = Record<string, unknown>;

function asRecord(value: unknown): Unknown {
  return value !== null && typeof value === "object" ? (value as Unknown) : {};
}

function num(source: Unknown, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function str(source: Unknown, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw === "string" && raw.trim() !== "") return raw;
  }
  return fallback;
}

function bool(source: Unknown, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") {
      const lowered = raw.toLowerCase();
      if (lowered === "true" || lowered === "1") return true;
      if (lowered === "false" || lowered === "0") return false;
    }
  }
  return fallback;
}

function role(source: Unknown): Role {
  const raw = str(source, ["role"], "peripheral").toLowerCase();
  return (ROLE_SET.has(raw) ? raw : "peripheral") as Role;
}

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1 && value <= 100) return value / 100; // бэк мог отдать проценты
  return Math.min(1, Math.max(0, value));
}

function normalizeNode(raw: unknown): GraphNode | null {
  const source = asRecord(raw);
  const id = num(source, ["id", "gid"], Number.NaN);
  if (!Number.isFinite(id)) return null;

  const depth = Math.max(0, Math.round(num(source, ["depth"], 0)));
  const out_receivers = Math.max(0, Math.round(num(source, ["out_receivers", "out_degree"], 0)));

  return {
    id,
    role: role(source),
    role_score: unit(num(source, ["role_score"], 0.5)),
    cluster_id: Math.round(num(source, ["cluster_id", "cluster"], 0)),
    priority_score: unit(num(source, ["priority_score", "priority"], 0)),
    depth,
    is_seed: bool(source, ["is_seed", "seed"], depth === 0),
    in_senders: Math.max(0, Math.round(num(source, ["in_senders", "in_degree"], 0))),
    out_receivers,
    sum_in: Math.max(0, num(source, ["sum_in"], 0)),
    sum_out: Math.max(0, num(source, ["sum_out"], 0)),
    // Если бэк не прислал флаг — выводим его из данных: 4-е колено без исходящих.
    is_cutoff: bool(source, ["is_cutoff", "cutoff"], depth >= 4 && out_receivers === 0),
    evidence: str(source, ["evidence", "why"], "Обоснование не передано бэкендом.").slice(0, 200),
  };
}

function endpointId(value: unknown): number {
  // react-force-graph подменяет source/target объектами узлов после старта симуляции.
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value !== null && typeof value === "object") {
    return num(value as Unknown, ["id", "gid"], Number.NaN);
  }
  return Number.NaN;
}

function normalizeLink(raw: unknown): GraphLink | null {
  const source = asRecord(raw);
  const from = endpointId(source.source ?? source.src);
  const to = endpointId(source.target ?? source.dst);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return {
    source: from,
    target: to,
    sum_kzt: Math.max(0, num(source, ["sum_kzt", "sum"], 0)),
    n_tx: Math.max(0, Math.round(num(source, ["n_tx", "tx_count"], 0))),
  };
}

/** top_gids приходит либо массивом, либо строкой «gid,gid,gid» (так отдаёт CSV-выгрузка). */
function gidList(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;\s]+/)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v !== 0);
  }
  return [];
}

function normalizeCluster(raw: unknown): Cluster {
  const source = asRecord(raw);
  const top_gids = gidList(source.top_gids);
  return {
    cluster_id: Math.round(num(source, ["cluster_id", "cluster"], 0)),
    n_nodes: Math.max(0, Math.round(num(source, ["n_nodes"], 0))),
    n_seed: Math.max(0, Math.round(num(source, ["n_seed"], 0))),
    sum_kzt_internal: Math.max(0, num(source, ["sum_kzt_internal"], 0)),
    top_gids,
    hypothesis: str(source, ["hypothesis"], "Гипотеза по кластеру не передана."),
  };
}

function normalizeTop(raw: unknown, index: number): TopItem | null {
  const source = asRecord(raw);
  const gid = num(source, ["gid", "id"], Number.NaN);
  if (!Number.isFinite(gid)) return null;
  return {
    rank: Math.round(num(source, ["rank"], index + 1)),
    gid,
    role: role(source),
    priority_score: unit(num(source, ["priority_score", "priority"], 0)),
    why: str(source, ["why", "evidence"], "Обоснование не передано бэкендом."),
  };
}

export function normalizeGraphData(raw: unknown): GraphData {
  const source = asRecord(raw);

  const nodes = (Array.isArray(source.nodes) ? source.nodes : [])
    .map(normalizeNode)
    .filter((n): n is GraphNode => n !== null);

  const known = new Set(nodes.map((n) => n.id));
  const links = (Array.isArray(source.links) ? source.links : [])
    .map(normalizeLink)
    .filter((l): l is GraphLink => l !== null && known.has(l.source) && known.has(l.target));

  const clusters = (Array.isArray(source.clusters) ? source.clusters : []).map(normalizeCluster);

  let top = (Array.isArray(source.top) ? source.top : [])
    .map(normalizeTop)
    .filter((t): t is TopItem => t !== null && known.has(t.gid));

  // Бэк не прислал топ — считаем его сами из priority_score, экран не должен пустовать.
  if (top.length === 0) {
    top = nodes
      .slice()
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, 20)
      .map((node, index) => ({
        rank: index + 1,
        gid: node.id,
        role: node.role,
        priority_score: node.priority_score,
        why: node.evidence,
      }));
  }

  return { nodes, links, clusters, top: top.sort((a, b) => a.rank - b.rank) };
}

/**
 * Итог шага агента. Бэкенд может отдать готовую фразу в `summary`, а может —
 * сырой `result` со списком записей; во втором случае описываем его сами,
 * чтобы в интерфейс не попал дамп JSON.
 */
function stepSummary(step: Unknown): string {
  const text = str(step, ["summary", "text"], "");
  if (text !== "") return text;

  const result = step.result;
  if (typeof result === "string") return result;
  if (typeof result === "number") return String(result);
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    // Один узел в ответе — называем его, а не пишем «записей: 1».
    const gid = num(result as Unknown, ["gid", "id"], Number.NaN);
    return Number.isFinite(gid) ? `узел ${gid}` : "";
  }
  if (Array.isArray(result)) {
    const gids = result
      .map((item) => num(asRecord(item), ["gid", "id"], Number.NaN))
      .filter((gid) => Number.isFinite(gid));
    if (gids.length > 0) {
      const shown = gids.slice(0, 3).join(", ");
      return `узлов в ответе: ${gids.length} (${shown}${gids.length > 3 ? ", …" : ""})`;
    }
    return `записей: ${result.length}`;
  }
  return "";
}

export function normalizeAskResponse(raw: unknown): AskResponse {
  const source = asRecord(raw);
  const steps = (Array.isArray(source.steps) ? source.steps : []).map((item) => {
    const step = asRecord(item);
    return {
      tool: str(step, ["tool", "name"], "unknown"),
      args: asRecord(step.args),
      summary: stepSummary(step),
    };
  });
  const highlight_gids = gidList(source.highlight_gids);

  const error = str(source, ["error"], "");
  const mode = str(source, ["mode"], "");
  const llmError = str(source, ["llm_error"], "");

  return {
    answer: str(source, ["answer", "text"], ""),
    steps,
    highlight_gids,
    ...(error ? { error } : {}),
    ...(mode ? { mode } : {}),
    ...(llmError ? { llm_error: llmError } : {}),
  };
}
