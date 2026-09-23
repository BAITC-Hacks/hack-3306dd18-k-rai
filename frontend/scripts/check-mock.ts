/**
 * Проверка генератора моков: структура должна соответствовать брифу.
 * Запуск: npx tsx scripts/check-mock.ts
 */
import { generateMockGraph } from "../lib/mock";
import { buildIndex, passThrough } from "../lib/graph";
import type { Role } from "../lib/types";

const graph = generateMockGraph();
const index = buildIndex(graph);

const byRole = new Map<Role, number>();
graph.nodes.forEach((n) => byRole.set(n.role, (byRole.get(n.role) ?? 0) + 1));

const byDepth = new Map<number, number>();
graph.nodes.forEach((n) => byDepth.set(n.depth, (byDepth.get(n.depth) ?? 0) + 1));

const consolidators = graph.nodes.filter((n) => n.role === "consolidator");
const distributors = graph.nodes.filter((n) => n.role === "distributor");
const coordinators = graph.nodes.filter((n) => n.role === "coordinator");
const cutoff = graph.nodes.filter((n) => n.is_cutoff);
const depth4 = graph.nodes.filter((n) => n.depth === 4);
const depth4WithOut = depth4.filter((n) => n.out_receivers > 0);
const longEvidence = graph.nodes.filter((n) => n.evidence.length > 200 || n.evidence.length === 0);

console.log("узлов:", graph.nodes.length, "рёбер:", graph.links.length);
console.log("оборот:", Math.round(index.stats.turnover).toLocaleString("ru-RU"), "₸");
console.log("по коленам:", [...byDepth.entries()].sort((a, b) => a[0] - b[0]));
console.log("по ролям:", [...byRole.entries()]);
console.log("кластеров:", graph.clusters.length, "топ:", graph.top.length);
console.log(
  "консолидаторы (отправителей):",
  consolidators.map((n) => `${n.id}:${n.in_senders} pass=${passThrough(n).toFixed(2)}`),
);
console.log("распределители (получателей):", distributors.map((n) => `${n.id}:${n.out_receivers}`));
console.log("координаторы:", coordinators.map((n) => `${n.id} seed-цепочек через ${n.in_senders} плательщиков`));
console.log("обрывов:", cutoff.length, "| узлов 4-го колена:", depth4.length, "| из них с исходящими:", depth4WithOut.length);
console.log("seed:", index.stats.seedCount, "| seed без переводов:", graph.nodes.filter((n) => n.is_seed && n.sum_out === 0).length);

const problems: string[] = [];
if (consolidators.length < 3) problems.push(`консолидаторов ${consolidators.length}, ожидалось >= 3`);
if (consolidators.some((n) => n.in_senders < 8 || n.in_senders > 15)) problems.push("у консолидатора число отправителей вне 8–15");
if (distributors.length < 2) problems.push(`распределителей ${distributors.length}, ожидалось >= 2`);
if (distributors.some((n) => n.out_receivers < 25)) problems.push("у распределителя меньше 25 получателей");
if (coordinators.length < 1) problems.push("координатор не найден");
if (depth4WithOut.length > 0) problems.push("есть узлы 4-го колена с исходящими переводами");
if (cutoff.length !== depth4.length) problems.push("не все узлы 4-го колена помечены обрывом");
if (graph.clusters.length < 5) problems.push(`кластеров ${graph.clusters.length}, ожидалось 5–6`);
if (graph.top.length !== 20) problems.push(`в топе ${graph.top.length} позиций`);
if (longEvidence.length > 0) problems.push(`evidence пустой или длиннее 200 символов у ${longEvidence.length} узлов`);
if (graph.nodes.some((n) => n.priority_score < 0 || n.priority_score > 1)) problems.push("priority_score вне 0..1");

console.log("\nтоп-3:");
graph.top.slice(0, 3).forEach((t) => console.log(` ${t.rank}. gid ${t.gid} (${t.role}) ${t.priority_score.toFixed(3)} — ${t.why}`));
console.log("\nкластеры:");
graph.clusters.forEach((c) => console.log(` #${c.cluster_id}: ${c.hypothesis}`));

if (problems.length > 0) {
  console.error("\nПРОБЛЕМЫ:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}
console.log("\nOK: структура моков соответствует брифу");
