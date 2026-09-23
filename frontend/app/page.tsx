"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AgentPanel from "@/components/AgentPanel";
import Legend from "@/components/Legend";
import NodeCard from "@/components/NodeCard";
import PriorityList from "@/components/PriorityList";
import SidePanel, { type TabId } from "@/components/SidePanel";
import type { ColorMode, GraphCanvasHandle } from "@/components/GraphCanvas";
import { fetchGraph } from "@/lib/api";
import { plural } from "@/lib/format";
import { analyzeNetwork, removedTurnoverShare } from "@/lib/resilience";
import ResilienceCard from "@/components/ResilienceCard";
import { buildIndex, connectedGids, findNodeByGid, linkEnds } from "@/lib/graph";
import { useReducedMotion } from "@/lib/useReducedMotion";
import type { GraphData } from "@/lib/types";

// react-force-graph обращается к window, поэтому обёртка подключается только на клиенте.
const GraphCanvas = dynamic(() => import("@/components/GraphCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted">Строим схему сети…</div>
  ),
});

const EMPTY_SET: Set<number> = new Set();

export default function Page() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [highlightGids, setHighlightGids] = useState<Set<number>>(EMPTY_SET);
  const [markedGids, setMarkedGids] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("priorities");
  const [question, setQuestion] = useState("");

  const [search, setSearch] = useState("");
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  const [colorMode, setColorMode] = useState<ColorMode>("role");

  // Сцена «Расследовать»: сначала видны только seed, дальше колена открываются по одному.
  const [revealedDepth, setRevealedDepth] = useState(0);
  const [revealing, setRevealing] = useState(false);

  // Изъятие топ-N узлов: сколько изымаем и изъяты ли они сейчас.
  const [topN, setTopN] = useState(5);
  const [seized, setSeized] = useState(false);

  const canvasRef = useRef<GraphCanvasHandle | null>(null);
  const cameraTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCamera = useCallback((action: () => void, delay = 0) => {
    if (cameraTimer.current !== null) clearTimeout(cameraTimer.current);
    cameraTimer.current = setTimeout(action, delay);
  }, []);
  useEffect(() => () => {
    if (cameraTimer.current !== null) clearTimeout(cameraTimer.current);
  }, []);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchGraph(controller.signal)
      .then((graph) => {
        if (!cancelled) setData(graph);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Не удалось загрузить граф. Проверьте, что бэкенд отдаёт /api/graph.");
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loadAttempt]);

  function retryGraph() {
    setError(null);
    setData(null);
    setSelectedId(null);
    setHighlightGids(EMPTY_SET);
    setMarkedGids([]);
    setSeized(false);
    setRevealing(false);
    setRevealedDepth(0);
    setLoadAttempt((attempt) => attempt + 1);
  }

  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  const markedSet = useMemo(() => new Set(markedGids), [markedGids]);

  const selectedNode = selectedId !== null ? (index?.nodeById.get(selectedId) ?? null) : null;
  const maxDepth = index?.stats.maxDepth ?? 0;

  // Фильтруем исходные массивы, не пересоздавая объекты узлов:
  // иначе симуляция потеряет координаты и граф будет прыгать на каждом колене.
  const visibleNodes = useMemo(
    () => (data ? data.nodes.filter((node) => node.depth <= revealedDepth) : []),
    [data, revealedDepth],
  );

  const visibleLinks = useMemo(() => {
    if (!data) return [];
    const shown = new Set(visibleNodes.map((node) => node.id));
    // Ребро показываем, только если видимы оба его конца.
    return data.links.filter((link) => {
      const [source, target] = linkEnds(link);
      return shown.has(source) && shown.has(target);
    });
  }, [data, visibleNodes]);

  const removedGids = useMemo(
    () => new Set(seized && data ? data.top.slice(0, topN).map((item) => item.gid) : []),
    [data, seized, topN],
  );

  /** Устойчивость считаем по всей сети, а не по видимой её части. */
  const resilience = useMemo(() => {
    if (!data || removedGids.size === 0) return null;
    return {
      before: analyzeNetwork(data.nodes, data.links),
      after: analyzeNetwork(data.nodes, data.links, removedGids),
      turnoverShare: removedTurnoverShare(data.links, removedGids),
    };
  }, [data, removedGids]);

  /** Раскрыть все колена разом — для поиска по скрытому узлу и для reduced motion. */
  const revealAll = useCallback(() => {
    setRevealing(false);
    setRevealedDepth(maxDepth);
  }, [maxDepth]);

  function startInvestigation() {
    if (!index || revealing) return;
    if (cameraTimer.current !== null) clearTimeout(cameraTimer.current);
    setSelectedId(null);
    setHighlightGids(EMPTY_SET);
    if (reducedMotion) {
      revealAll();
      setActiveTab("priorities");
      // Узлы появятся только после перерисовки — подгонять камеру сразу бессмысленно,
      // она подогналась бы по одним seed-узлам.
      scheduleCamera(() => canvasRef.current?.zoomToFit(0, 60), 400);
      return;
    }
    setRevealing(true);
    setRevealedDepth(0);
  }

  // Каждые 1,2 секунды открывается следующее колено.
  useEffect(() => {
    if (!revealing) return;

    if (revealedDepth >= maxDepth) {
      // Состояние снимаем в колбэке таймера, а не в теле эффекта: синхронный
      // setState здесь вызвал бы лишний каскад рендеров.
      const timer = setTimeout(() => {
        setRevealing(false);
        canvasRef.current?.zoomToFit(600, 60);
        setActiveTab("priorities");
      }, 600);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => setRevealedDepth((depth) => depth + 1), 1200);
    return () => clearTimeout(timer);
  }, [revealing, revealedDepth, maxDepth]);

  /**
   * Узлы могут быть скрыты нераскрытым коленом. Раскрываем всё и сообщаем,
   * потребовалось ли это: камере тогда нужен кадр, чтобы у новых узлов
   * появились координаты.
   */
  const ensureVisible = useCallback(
    (gids: number[]): boolean => {
      if (!index) return false;
      const hidden = gids.some((gid) => (index.nodeById.get(gid)?.depth ?? 0) > revealedDepth);
      if (hidden) revealAll();
      return hidden;
    },
    [index, revealAll, revealedDepth],
  );

  /** Выбрать узел: подсветить его связи, навести камеру, открыть карточку. */
  const focusNode = useCallback(
    (gid: number, options?: { openCard?: boolean }) => {
      if (!index) return;
      const node = index.nodeById.get(gid);
      if (!node) return;

      const neighbors = connectedGids(index, gid);
      setSelectedId(gid);
      setHighlightGids(neighbors);
      if (options?.openCard !== false) setActiveTab("node");

      const hidden = ensureVisible([...neighbors]);
      scheduleCamera(() => canvasRef.current?.focusNode(gid), hidden ? 400 : 0);
    },
    [ensureVisible, index, scheduleCamera],
  );

  const clearSelection = useCallback(() => {
    if (cameraTimer.current !== null) clearTimeout(cameraTimer.current);
    setSelectedId(null);
    setHighlightGids(EMPTY_SET);
  }, []);

  function handleSearch() {
    const raw = search.trim();
    if (!index || raw === "") return;

    if (!/^\d+$/.test(raw)) {
      setSearchMessage("gid — это целое число, например 240691.");
      return;
    }
    const node = findNodeByGid(index, raw);
    if (!node) {
      setSearchMessage(`Узла ${raw} нет в графе`);
      return;
    }
    setSearchMessage(null);
    focusNode(node.id);
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-edge px-5 py-3">
        <h1 className="mr-2 text-lg font-semibold tracking-tight">Граф денег</h1>

        <div className="flex items-center gap-2">
          <label htmlFor="gid-search" className="sr-only">
            Поиск по gid
          </label>
          <input
            id="gid-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSearchMessage(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSearch();
            }}
            inputMode="numeric"
            placeholder="gid…"
            className="tabular w-48 max-w-full rounded-md border border-edge bg-panel px-3 py-1.5 text-sm outline-none placeholder:text-muted/70 focus:border-muted"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:border-muted"
          >
            Найти
          </button>
        </div>

        <button
          type="button"
          onClick={startInvestigation}
          disabled={!index || index.stats.nodeCount === 0 || revealing}
          className="rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:border-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {revealing
            ? `Раскрываем ${Math.min(revealedDepth + 1, maxDepth)}-е колено…`
            : revealedDepth >= maxDepth && maxDepth > 0
              ? "Расследовать заново"
              : "Расследовать"}
        </button>

        <div className="flex items-center gap-2">
          <label htmlFor="top-n" className="sr-only">
            Сколько узлов изымать
          </label>
          <select
            id="top-n"
            value={topN}
            onChange={(event) => {
              setTopN(Number(event.target.value));
              setSeized(false);
            }}
            className="tabular rounded-md border border-edge bg-panel px-2 py-1.5 text-sm outline-none focus:border-muted"
          >
            {[5, 10, 20].map((value) => (
              <option key={value} value={value}>
                топ-{value}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSeized((current) => !current)}
            disabled={!index || index.stats.nodeCount === 0}
            className="rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:border-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {seized ? "Вернуть" : `Изъять топ-${topN}`}
          </button>
        </div>

        {searchMessage ? <p role="status" className="break-all text-sm text-muted">{searchMessage}</p> : null}

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Цвет:</span>
          <div className="flex overflow-hidden rounded-md border border-edge">
            {(["role", "cluster"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={colorMode === mode}
                onClick={() => setColorMode(mode)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  colorMode === mode ? "bg-edge text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {mode === "role" ? "роли" : "кластеры"}
              </button>
            ))}
          </div>
        </div>

        <p className="ml-auto text-xs text-muted">
          Роли — гипотезы для проверки аналитиком, а не утверждение о виновности
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <main className="relative min-h-[320px] min-w-0 flex-1 md:min-h-0">
          {error || (data && data.nodes.length === 0) ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted">
              <p role="status">{error ?? "В выгрузке нет узлов. Проверьте данные и загрузите граф снова."}</p>
              <button type="button" onClick={retryGraph} className="rounded-md border border-edge px-3 py-2 hover:border-muted">
                Загрузить снова
              </button>
            </div>
          ) : !data || !index ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              Загружаем выгрузку переводов…
            </div>
          ) : (
            <>
              <GraphCanvas
                ref={canvasRef}
                nodes={visibleNodes}
                links={visibleLinks}
                colorMode={colorMode}
                selectedId={selectedId}
                highlightGids={highlightGids}
                markedGids={markedSet}
                removedGids={removedGids}
                topGids={index.topGids}
                reducedMotion={reducedMotion}
                onNodeClick={(node, event) => {
                  if (event.shiftKey) {
                    setMarkedGids((current) =>
                      current.includes(node.id)
                        ? current.filter((gid) => gid !== node.id)
                        : [...current, node.id],
                    );
                    setActiveTab("agent");
                    return;
                  }
                  focusNode(node.id);
                }}
                onBackgroundClick={clearSelection}
              />
              <Legend
                stats={index.stats}
                visibleNodes={visibleNodes.length}
                visibleLinks={visibleLinks.length}
                colorMode={colorMode}
              />

              {revealedDepth === 0 && !revealing ? (
                <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center px-6">
                  <p className="max-w-lg rounded-lg border border-edge bg-panel/90 px-4 py-3 text-center text-sm leading-relaxed">
                    <span className="tabular">{index.stats.seedCount}</span>{" "}
                    {plural(index.stats.seedCount, "клиент", "клиента", "клиентов")} из запроса
                    правоохранительных органов. Нажмите «Расследовать» — выгрузка раскроется на{" "}
                    <span className="tabular">{maxDepth}</span>{" "}
                    {plural(maxDepth, "колено", "колена", "колен")} вглубь.
                  </p>
                </div>
              ) : null}

              {resilience ? (
                <ResilienceCard
                  removedCount={removedGids.size}
                  before={resilience.before}
                  after={resilience.after}
                  turnoverShare={resilience.turnoverShare}
                  onRestore={() => setSeized(false)}
                />
              ) : null}
            </>
          )}
        </main>

        {data && index && data.nodes.length > 0 ? (
          <SidePanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            priorities={
              <PriorityList top={data.top} selectedId={selectedId} onSelect={(gid) => focusNode(gid)} />
            }
            node={
              selectedNode ? (
                <div className="h-full overflow-y-auto">
                  <NodeCard
                    node={selectedNode}
                    index={index}
                    onGoToNode={(gid) => focusNode(gid)}
                    onAskAgent={(prefilled) => {
                      setQuestion(prefilled);
                      setMarkedGids([selectedNode.id]);
                      setActiveTab("agent");
                    }}
                  />
                </div>
              ) : (
                <p className="p-4 text-sm text-muted">
                  Кликните узел на схеме или выберите строку в списке приоритетов — здесь появится
                  карточка с цифрами и обоснованием роли.
                </p>
              )
            }
            agent={
              <AgentPanel
                question={question}
                onQuestionChange={setQuestion}
                markedGids={markedGids}
                onUnmark={(gid) => setMarkedGids((current) => current.filter((id) => id !== gid))}
                onClearMarks={() => setMarkedGids([])}
                onAnswer={(gids) => {
                  if (cameraTimer.current !== null) clearTimeout(cameraTimer.current);
                  setHighlightGids(new Set(gids));
                  setSelectedId(null);
                  if (gids.length === 0) return;
                  // Агента могут спросить до «Расследовать» — тогда узлы ответа скрыты.
                  const hidden = ensureVisible(gids);
                  scheduleCamera(
                    () => canvasRef.current?.zoomToNodes(gids, 80),
                    hidden ? 400 : 0,
                  );
                }}
                onGoToNode={(gid) => focusNode(gid)}
                isKnownGid={(gid) => index.nodeById.has(gid)}
              />
            }
          />
        ) : null}
      </div>
    </div>
  );
}
