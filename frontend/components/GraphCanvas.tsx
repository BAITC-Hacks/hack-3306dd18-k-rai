"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";

import { endpointId } from "@/lib/graph";
import { clusterColor, roleColor } from "@/lib/roles";
import type { GraphLink, GraphNode } from "@/lib/types";

export type ColorMode = "role" | "cluster";

export interface GraphCanvasHandle {
  /** Плавный наезд камеры на узел. */
  focusNode: (gid: number, zoomLevel?: number) => void;
  /** Показать группу узлов целиком. */
  zoomToNodes: (gids: number[], padding?: number) => void;
  zoomToFit: (durationMs?: number, padding?: number) => void;
}

export interface GraphCanvasProps {
  nodes: GraphNode[];
  links: GraphLink[];
  colorMode: ColorMode;
  selectedId: number | null;
  /** Подсветка от поиска или агента: остальное приглушается. */
  highlightGids: Set<number>;
  /** Выделение shift+кликом для вопроса агенту. */
  markedGids: Set<number>;
  /** Изъятые узлы — гаснут, но остаются на месте. */
  removedGids: Set<number>;
  /** Топ-20: их gid подписываются на холсте при приближении. */
  topGids: Set<number>;
  reducedMotion: boolean;
  onNodeClick: (node: GraphNode, event: MouseEvent) => void;
  onBackgroundClick: () => void;
  ref?: RefObject<GraphCanvasHandle | null>;
}

type FGNode = NodeObject<GraphNode>;
type FGLink = LinkObject<GraphNode, GraphLink>;
type FGMethods = ForceGraphMethods<FGNode, FGLink>;

const COLOR_DIM_LINK = "rgba(36, 56, 79, 0.35)";
const COLOR_LINK = "#24384f";
const COLOR_LINK_ACTIVE = "#8fa3ba";
const COLOR_INK = "#e6edf5";
const COLOR_ACCENT = "#4cc9f0";

export default function GraphCanvas({
  nodes,
  links,
  colorMode,
  selectedId,
  highlightGids,
  markedGids,
  removedGids,
  topGids,
  reducedMotion,
  onNodeClick,
  onBackgroundClick,
  ref,
}: GraphCanvasProps) {
  const fgRef = useRef<FGMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const didInitialFit = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Узлы разводим сильнее, чем по умолчанию: иначе на сотнях узлов
  // получается плотный ком, в котором не видно структуры.
  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;
    const charge = graph.d3Force("charge");
    if (charge && typeof charge.strength === "function") charge.strength(-55);
    const link = graph.d3Force("link");
    if (link && typeof link.distance === "function") link.distance(34);
  }, [size.width]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Узлы отдаём теми же объектами, что пришли из данных, — иначе симуляция
  // потеряет координаты и граф начнёт прыгать при каждом фильтре.
  // Рёбра, наоборот, пересобираем: force-graph подменяет их source/target
  // объектами узлов, а фильтрованному набору нужны чистые id.
  const graphData = useMemo(
    () => ({
      nodes,
      links: links.map((link) => ({
        source: endpointId(link.source),
        target: endpointId(link.target),
        sum_kzt: link.sum_kzt,
        n_tx: link.n_tx,
      })),
    }),
    [nodes, links],
  );

  const maxLinkSum = useMemo(
    () => links.reduce((acc, link) => Math.max(acc, link.sum_kzt), 1),
    [links],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusNode(gid, zoomLevel = 4) {
        const node = nodes.find((n) => n.id === gid) as FGNode | undefined;
        const graph = fgRef.current;
        if (!graph || !node || typeof node.x !== "number" || typeof node.y !== "number") return;
        didInitialFit.current = true;
        graph.centerAt(node.x, node.y, reducedMotion ? 0 : 800);
        graph.zoom(zoomLevel, reducedMotion ? 0 : 800);
      },
      zoomToNodes(gids, padding = 80) {
        const graph = fgRef.current;
        if (!graph || gids.length === 0) return;
        didInitialFit.current = true;
        const set = new Set(gids);
        graph.zoomToFit(reducedMotion ? 0 : 600, padding, (node) => set.has(Number(node.id)));
      },
      zoomToFit(durationMs = 600, padding = 60) {
        didInitialFit.current = true;
        fgRef.current?.zoomToFit(reducedMotion ? 0 : durationMs, padding);
      },
    }),
    [nodes, reducedMotion],
  );

  const isActiveLink = useCallback(
    (link: FGLink) => {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (removedGids.has(source) || removedGids.has(target)) return false;
      if (selectedId !== null && (source === selectedId || target === selectedId)) return true;
      if (highlightGids.size === 0) return false;
      return highlightGids.has(source) && highlightGids.has(target);
    },
    [selectedId, highlightGids, removedGids],
  );

  const nodeCanvasObject = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const { x, y } = node;
      if (typeof x !== "number" || typeof y !== "number") return;

      const gid = Number(node.id);
      const radius = 3 + node.priority_score * 7;
      const removed = removedGids.has(gid);
      const focusActive = highlightGids.size > 0;
      const focused = highlightGids.has(gid);

      let alpha = 1;
      if (node.is_cutoff) alpha *= 0.35;
      if (removed) alpha *= 0.12;
      else if (focusActive && !focused) alpha *= 0.18;

      const color = colorMode === "role" ? roleColor(node.role) : clusterColor(node.cluster_id);

      ctx.save();
      ctx.globalAlpha = alpha;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = removed ? "#3a4c63" : color;
      ctx.fill();

      if (node.is_cutoff) {
        // Обрыв выгрузки: пунктирный контур — узел не конечный получатель.
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1 / globalScale + 0.4;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (node.is_seed) {
        ctx.lineWidth = 1 / globalScale + 0.5;
        ctx.strokeStyle = COLOR_INK;
        ctx.stroke();
      }

      ctx.restore();

      if (markedGids.has(gid)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
        ctx.lineWidth = 1.5 / globalScale + 0.6;
        ctx.strokeStyle = COLOR_ACCENT;
        ctx.stroke();
        ctx.restore();
      }

      if (gid === selectedId) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, 2 * Math.PI);
        ctx.lineWidth = 2 / globalScale + 0.6;
        ctx.strokeStyle = COLOR_INK;
        ctx.stroke();
        ctx.restore();
      }

      // Подписи топ-20 появляются только при приближении, чтобы не засорять холст.
      if (globalScale > 2 && (topGids.has(gid) || gid === selectedId) && !removed) {
        ctx.save();
        ctx.globalAlpha = focusActive && !focused ? 0.3 : 0.95;
        ctx.font = `${Math.max(3, 11 / globalScale)}px "Golos Text", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = COLOR_INK;
        ctx.fillText(String(gid), x, y + radius + 2 / globalScale);
        ctx.restore();
      }
    },
    [colorMode, highlightGids, markedGids, removedGids, selectedId, topGids],
  );

  const nodePointerAreaPaint = useCallback(
    (node: FGNode, paintColor: string, ctx: CanvasRenderingContext2D) => {
      const { x, y } = node;
      if (typeof x !== "number" || typeof y !== "number") return;
      ctx.beginPath();
      ctx.arc(x, y, 3 + node.priority_score * 7 + 2, 0, 2 * Math.PI);
      ctx.fillStyle = paintColor;
      ctx.fill();
    },
    [],
  );

  const linkColor = useCallback(
    (link: FGLink) => {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (removedGids.has(source) || removedGids.has(target)) return "rgba(36, 56, 79, 0.18)";
      if (isActiveLink(link)) return COLOR_LINK_ACTIVE;
      if (highlightGids.size > 0 || selectedId !== null) return COLOR_DIM_LINK;
      return COLOR_LINK;
    },
    [highlightGids, isActiveLink, removedGids, selectedId],
  );

  const handleNodeClick = useCallback(
    (node: FGNode, event: MouseEvent) => {
      onNodeClick(node as GraphNode, event);
    },
    [onNodeClick],
  );

  return (
    <div ref={containerRef} className="h-full w-full">
      {size.width > 0 && size.height > 0 ? (
        <ForceGraph2D<GraphNode, GraphLink>
          ref={fgRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="#0f1b2d"
          nodeRelSize={1}
          nodeLabel={(node) => `gid ${node.id}`}
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={nodePointerAreaPaint}
          linkColor={linkColor}
          linkWidth={(link) => (isActiveLink(link) ? 1.8 : 0.5)}
          linkDirectionalArrowLength={(link) => (isActiveLink(link) ? 4 : 2.2)}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={linkColor}
          // Частицы только на подсвеченных рёбрах: на тысячах рёбер иначе всё встанет.
          linkDirectionalParticles={(link) => (!reducedMotion && isActiveLink(link) ? 2 : 0)}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleColor={() => COLOR_ACCENT}
          linkDirectionalParticleSpeed={(link) =>
            0.004 + (link.sum_kzt / maxLinkSum) * 0.008
          }
          onNodeClick={handleNodeClick}
          onBackgroundClick={onBackgroundClick}
          onEngineStop={() => {
            if (didInitialFit.current) return;
            didInitialFit.current = true;
            fgRef.current?.zoomToFit(reducedMotion ? 0 : 400, 60);
          }}
          cooldownTicks={reducedMotion ? 0 : 120}
          d3AlphaDecay={0.035}
          d3VelocityDecay={0.32}
          // Перерисовка ставится на паузу, когда ничего не изменилось: колбэки
          // отрисовки пересоздаются при смене подсветки, поэтому кадр не «залипает».
          autoPauseRedraw
          enableNodeDrag={false}
          minZoom={0.05}
          maxZoom={12}
        />
      ) : null}
    </div>
  );
}
