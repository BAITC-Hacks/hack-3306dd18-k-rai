"use client";

import { formatCount, formatKzt, formatPercent } from "@/lib/format";
import { neighborsOf, passThrough, type GraphIndex, type Neighbor } from "@/lib/graph";
import { ROLE_HINT, roleColor, roleLabel } from "@/lib/roles";
import type { GraphNode } from "@/lib/types";

interface NodeCardProps {
  node: GraphNode;
  index: GraphIndex;
  onGoToNode: (gid: number) => void;
  onAskAgent: (question: string) => void;
}

export default function NodeCard({ node, index, onGoToNode, onAskAgent }: NodeCardProps) {
  const entry = neighborsOf(index, node.id);
  const pass = passThrough(node);
  const cluster = index.clusterById.get(node.cluster_id);

  // Граф собран только по исходящим переводам, поэтому входящие из-за пределов
  // выборки в него не попали. У таких узлов отношение «отдал / получил» недостоверно.
  const outflowExceedsInflow = node.sum_out > node.sum_in * 1.2;

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="tabular break-all text-lg font-semibold">gid {node.id}</h2>
          <span className="text-xs text-muted">кластер {node.cluster_id}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-2 rounded-full border border-edge px-2.5 py-1 text-xs"
            title={ROLE_HINT[node.role]}
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: roleColor(node.role) }}
            />
            {roleLabel(node.role)}
            <span className="tabular text-muted">{formatPercent(node.role_score)}</span>
          </span>

          <span className="rounded-full border border-edge px-2.5 py-1 text-xs text-muted">
            {node.depth === 0 ? "seed-уровень" : `${node.depth}-е колено`}
          </span>

          {node.is_seed ? (
            <span className="rounded-full border border-ink/40 px-2.5 py-1 text-xs text-ink">
              из списка правоохранительных органов
            </span>
          ) : null}

          {node.is_cutoff ? (
            <span className="rounded-full border border-dashed border-edge px-2.5 py-1 text-xs text-muted">
              обрыв выгрузки
            </span>
          ) : null}
        </div>
      </header>

      <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="отправителей" value={formatCount(node.in_senders)} />
        <Stat label="получателей" value={formatCount(node.out_receivers)} />
        <Stat label="пришло" value={formatKzt(node.sum_in)} />
        <Stat label="ушло" value={formatKzt(node.sum_out)} />
        <Stat
          label="доля пропуска"
          value={node.is_seed ? "не применяется" : node.sum_in > 0 ? formatPercent(pass) : "нет входящих"}
          hint={
            node.is_seed ? "У seed входящий поток неполный" : node.sum_in > 0
              ? "сколько из полученного ушло дальше"
              : "входящих переводов в выгрузке нет"
          }
        />
        <Stat label="приоритет" value={node.priority_score.toFixed(2)} />
      </dl>

      <section className="rounded-md border border-edge bg-canvas/60 p-3">
        <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">Почему такая роль</h3>
        <p className="text-sm leading-relaxed">{node.evidence}</p>
      </section>

      {node.is_cutoff ? (
        <p className="rounded-md border border-dashed border-edge p-3 text-sm leading-relaxed text-muted">
          Выгрузка обрывается на 4-м колене: куда деньги ушли дальше, неизвестно. Узел не считается
          конечным получателем.
        </p>
      ) : null}

      {outflowExceedsInflow ? (
        <p className="rounded-md border border-dashed border-edge p-3 text-sm leading-relaxed text-muted">
          Узел отдал больше, чем получил по данным выгрузки. Прослежены только исходящие переводы,
          поэтому деньги, пришедшие к нему из-за пределов выборки, в граф не попали — доля пропуска
          для такого узла недостоверна.
        </p>
      ) : null}

      {cluster ? (
        <section>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">Кластер {cluster.cluster_id}</h3>
          <p className="text-sm leading-relaxed text-muted">{cluster.hypothesis}</p>
        </section>
      ) : null}

      <NeighborList
        title="Кто платил"
        empty="Входящих переводов в выгрузке нет."
        items={entry.in}
        index={index}
        onGoToNode={onGoToNode}
      />
      <NeighborList
        title="Кому платил"
        empty={
          node.is_cutoff
            ? "Исходящих переводов в выгрузке нет — она обрывается на 4-м колене."
            : "Исходящих переводов в выгрузке нет. Движение за её пределами неизвестно."
        }
        items={entry.out}
        index={index}
        onGoToNode={onGoToNode}
      />

      <button
        type="button"
        className="rounded-md border border-edge px-3 py-2 text-sm transition-colors hover:border-muted"
        onClick={() => onAskAgent(`Куда уходят деньги от узла ${node.id}?`)}
      >
        Спросить агента
      </button>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function NeighborList({
  title,
  empty,
  items,
  index,
  onGoToNode,
}: {
  title: string;
  empty: string;
  items: Neighbor[];
  index: GraphIndex;
  onGoToNode: (gid: number) => void;
}) {
  const shown = items.slice(0, 10);

  return (
    <section>
      <h3 className="mb-2 flex items-baseline justify-between text-xs uppercase tracking-wide text-muted">
        <span>{title}</span>
        {items.length > 10 ? <span className="tabular normal-case">показаны 10 из {items.length}</span> : null}
      </h3>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((neighbor) => {
            const target = index.nodeById.get(neighbor.gid);
            return (
              <li key={neighbor.gid}>
                <button
                  type="button"
                  className="grid w-full min-w-0 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded px-1.5 py-1.5 text-left transition-colors hover:bg-edge/50"
                  onClick={() => onGoToNode(neighbor.gid)}
                >
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: target ? roleColor(target.role) : "#5C6F87" }}
                  />
                  <span className="tabular col-span-2 break-all text-sm">{neighbor.gid}</span>
                  <span className="tabular col-start-2 text-sm text-muted">{formatKzt(neighbor.sum_kzt)}</span>
                  <span className="tabular text-right text-xs text-muted">
                    {formatCount(neighbor.n_tx)} тр.
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
