/**
 * Проверка метрик устойчивости: что происходит с сетью при изъятии топ-N.
 * Запуск: npx tsx scripts/check-resilience.ts
 */
import { generateMockGraph } from "../lib/mock";
import { analyzeNetwork, removedTurnoverShare } from "../lib/resilience";

const graph = generateMockGraph();
const before = analyzeNetwork(graph.nodes, graph.links);

console.log(
  `до изъятия: компонент ${before.components}, крупнейшая ${before.largestComponent}, ` +
    `связей ${before.links}, оборот ${Math.round(before.turnover).toLocaleString("ru-RU")} ₸`,
);

[5, 10, 20].forEach((n) => {
  const removed = new Set(graph.top.slice(0, n).map((item) => item.gid));
  const after = analyzeNetwork(graph.nodes, graph.links, removed);
  const share = removedTurnoverShare(graph.links, removed);
  console.log(
    `топ-${String(n).padEnd(2)} → компонент ${after.components} (было ${before.components}), ` +
      `крупнейшая ${after.largestComponent} (было ${before.largestComponent}), ` +
      `оборот через изъятые ${(share * 100).toFixed(1)}%`,
  );
});
