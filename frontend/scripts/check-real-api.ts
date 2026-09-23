/**
 * Сверка фронта с реальной выгрузкой бэкенда.
 * Прогоняет сохранённый ответ /api/graph через нормализацию и индекс,
 * считает устойчивость и сравнивает с ответом /api/resilience.
 *
 * Запуск: npx tsx scripts/check-real-api.ts <путь к graph.json> [путь к resilience.json]
 */
import { readFileSync } from "node:fs";

import { buildIndex } from "../lib/graph";
import { normalizeGraphData } from "../lib/normalize";
import { analyzeNetwork, removedTurnoverShare } from "../lib/resilience";

const graphPath = process.argv[2];
if (!graphPath) {
  console.error("Укажите путь к сохранённому ответу /api/graph");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(graphPath, "utf8"));
const rawNodes = Array.isArray(raw.nodes) ? raw.nodes.length : 0;
const rawLinks = Array.isArray(raw.links) ? raw.links.length : 0;

const data = normalizeGraphData(raw);
const index = buildIndex(data);

const problems: string[] = [];

console.log("=== нормализация ===");
console.log(`узлов   : ${data.nodes.length} из ${rawNodes} в ответе`);
console.log(`рёбер   : ${data.links.length} из ${rawLinks} в ответе`);
console.log(`кластеров: ${data.clusters.length} | топ: ${data.top.length}`);
if (data.nodes.length !== rawNodes) problems.push("часть узлов отброшена нормализацией");
if (data.links.length !== rawLinks) problems.push("часть рёбер отброшена нормализацией (концы вне списка узлов?)");

console.log("\n=== что увидит аналитик ===");
console.log(`оборот   : ${Math.round(index.stats.turnover).toLocaleString("ru-RU")} ₸`);
console.log(`seed     : ${index.stats.seedCount}`);
console.log(`обрывов  : ${index.stats.cutoffCount}`);
console.log(`колен    : ${index.depths.join(", ")}`);

const roles = new Map<string, number>();
data.nodes.forEach((n) => roles.set(n.role, (roles.get(n.role) ?? 0) + 1));
console.log("роли     :", Object.fromEntries(roles));

const emptyEvidence = data.nodes.filter((n) => !n.evidence.trim()).length;
if (emptyEvidence > 0) problems.push(`у ${emptyEvidence} узлов пустой evidence`);

// Кластеры: top_gids приходит строкой через запятую — проверяем, что распарсилось.
const clustersWithTop = data.clusters.filter((c) => c.top_gids.length > 0).length;
console.log(`кластеров с разобранным top_gids: ${clustersWithTop} из ${data.clusters.length}`);
if (clustersWithTop === 0 && data.clusters.length > 0) problems.push("top_gids не разобрался ни у одного кластера");

const unknownTopGid = data.clusters
  .flatMap((c) => c.top_gids)
  .filter((gid) => !index.nodeById.has(gid)).length;
if (unknownTopGid > 0) problems.push(`${unknownTopGid} gid из top_gids отсутствуют среди узлов`);

// Точность больших gid: 18-значные id за пределами безопасного диапазона JS.
const unsafe = data.nodes.filter((n) => !Number.isSafeInteger(n.id)).length;
console.log(`\ngid за пределами MAX_SAFE_INTEGER: ${unsafe}`);
if (unsafe > 0) {
  const sample = data.nodes.find((n) => !Number.isSafeInteger(n.id));
  const roundTrips = sample ? String(sample.id) === String(Number(String(sample.id))) : false;
  console.log(`  пример: ${sample?.id} | строковое представление устойчиво: ${roundTrips}`);
  const ids = new Set(data.nodes.map((n) => n.id));
  console.log(`  уникальных id после парсинга: ${ids.size} из ${data.nodes.length}`);
  if (ids.size !== data.nodes.length) problems.push("разные gid схлопнулись в одно число — потеря точности");
}

console.log("\n=== устойчивость (считает фронт) ===");
const before = analyzeNetwork(data.nodes, data.links);
console.log(`до изъятия: компонент ${before.components}, крупнейшая ${before.largestComponent}, узлов ${before.nodes}`);

const resiliencePath = process.argv[3];
if (resiliencePath) {
  const backend = JSON.parse(readFileSync(resiliencePath, "utf8"));
  const removed = new Set<number>((backend.removed_gids ?? []).map(Number));
  const after = analyzeNetwork(data.nodes, data.links, removed);
  const share = removedTurnoverShare(data.links, removed);

  console.log(`\n=== сверка с /api/resilience (изъято ${removed.size}) ===`);
  const row = (label: string, mine: number, theirs: number, tolerance = 0) => {
    const ok = Math.abs(mine - theirs) <= tolerance;
    console.log(`${ok ? "OK " : "РАСХОЖДЕНИЕ"} ${label}: фронт ${mine} | бэкенд ${theirs}`);
    if (!ok) problems.push(`${label}: фронт ${mine}, бэкенд ${theirs}`);
  };
  row("компонент до", before.components, backend.before?.components);
  row("крупнейшая до", before.largestComponent, backend.before?.largest_component_size);
  row("компонент после", after.components, backend.after?.components);
  row("крупнейшая после", after.largestComponent, backend.after?.largest_component_size);
  const theirShare = Number(backend.turnover_share_removed);
  const shareOk = Math.abs(share - theirShare) < 0.005;
  console.log(
    `${shareOk ? "OK " : "РАСХОЖДЕНИЕ"} доля оборота: фронт ${(share * 100).toFixed(2)}% | бэкенд ${(theirShare * 100).toFixed(2)}%`,
  );
  if (!shareOk) problems.push(`доля оборота: фронт ${share.toFixed(4)}, бэкенд ${theirShare.toFixed(4)}`);
}

if (problems.length > 0) {
  console.error("\nПРОБЛЕМЫ:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}
console.log("\nOK: фронт согласован с ответом бэкенда");
