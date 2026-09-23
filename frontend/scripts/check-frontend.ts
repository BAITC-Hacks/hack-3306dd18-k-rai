/**
 * Регрессии фронтенда без обращений к внешнему API.
 * Запуск: npx tsx scripts/check-frontend.ts
 */
import assert from "node:assert/strict";
import { buildIndex, findNodeByGid } from "../lib/graph";
import { normalizeGraphData } from "../lib/normalize";
import { analyzeNetwork, removedTurnoverShare } from "../lib/resilience";

async function main() {
  const graph = normalizeGraphData({
    nodes: [
      { gid: "100000000331309100", is_seed: true },
      { gid: 2, depth: 1 },
      { gid: 3, depth: 2 },
      { gid: 4, depth: 4 },
    ],
    links: [
      { src: "100000000331309100", dst: 2, sum_kzt: 100 },
      { src: 2, dst: 3, sum_kzt: 50 },
      { src: 99, dst: 3, sum_kzt: 900 },
    ],
  });
  const index = buildIndex(graph);
  assert.equal(findNodeByGid(index, "100000000331309100")?.id, graph.nodes[0].id);
  assert.equal(findNodeByGid(index, "100000000331309101"), undefined);
  assert.equal(findNodeByGid(index, "1e17"), undefined);
  assert.equal(findNodeByGid(index, "0x2"), undefined);
  assert.equal(findNodeByGid(index, " 002 ")?.id, 2);
  assert.equal(graph.links.length, 2, "Ребро с отсутствующим узлом отбрасывается");

  const before = analyzeNetwork(graph.nodes, graph.links);
  const removed = new Set([2]);
  const after = analyzeNetwork(graph.nodes, graph.links, removed);
  assert.deepEqual(before, { components: 2, largestComponent: 3, nodes: 4, links: 2, turnover: 150 });
  assert.deepEqual(after, { components: 3, largestComponent: 1, nodes: 3, links: 0, turnover: 0 });
  assert.equal(removedTurnoverShare(graph.links, removed), 1);
  assert.deepEqual(analyzeNetwork(graph.nodes, graph.links), before, "Изъятие не меняет исходные данные");
  assert.equal(analyzeNetwork([], []).components, 0);
  assert.equal(removedTurnoverShare([], removed), 0);

  const ranked = normalizeGraphData({
    nodes: Array.from({ length: 30 }, (_, id) => ({ id: id + 1, priority_score: (30 - id) / 30 })),
    top: Array.from({ length: 30 }, (_, id) => ({ gid: id + 1, rank: id + 1 })),
  });
  assert.equal(buildIndex(ranked).topGids.size, 20, "На холсте подписываются только топ-20");
  console.log("OK: точный поиск, нормализация, подписи и расчёт устойчивости");

  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  const oldMocks = process.env.NEXT_PUBLIC_USE_MOCKS;
  process.env.NEXT_PUBLIC_USE_MOCKS = "false";
  try {
    const { fetchGraph, askAgent } = await import("../lib/api");
    let sent: RequestInit | undefined;
    globalThis.fetch = async (_url, options) => {
      sent = options;
      return new Response(JSON.stringify(options?.method === "POST"
        ? { answer: "**Ответ**", steps: [], highlight_gids: [2] }
        : { nodes: [{ id: 2 }], links: [] }), { status: 200 });
    };
    assert.equal((await fetchGraph()).nodes[0].id, 2);
    const answer = await askAgent({ question: "Кто получатель?", selected_gids: [2] });
    assert.equal(answer.answer, "**Ответ**");
    assert.deepEqual(JSON.parse(String(sent?.body)), { question: "Кто получатель?", selected_gids: [2] });
    globalThis.fetch = async () => new Response("Недоступно", { status: 503 });
    await assert.rejects(fetchGraph(), /503/);

    globalThis.fetch = async (_url, options) => {
      const signal = options?.signal;
      return {
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("Отменено", "AbortError"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        }),
      } as Response;
    };
    const controller = new AbortController();
    const request = fetchGraph(controller.signal);
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });

    // Не ждём 30/45 секунд: запускаем таймаут сразу и проверяем чтение тела.
    globalThis.setTimeout = ((callback: () => void) => originalTimeout(callback, 0)) as typeof setTimeout;
    await assert.rejects(fetchGraph(), { name: "AbortError" });
    await assert.rejects(askAgent({ question: "Проверка" }), { name: "AbortError" });
    console.log("OK: запросы API, выбранные gid, ошибки, отмена и таймаут чтения ответа");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
    if (oldMocks === undefined) delete process.env.NEXT_PUBLIC_USE_MOCKS;
    else process.env.NEXT_PUBLIC_USE_MOCKS = oldMocks;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
