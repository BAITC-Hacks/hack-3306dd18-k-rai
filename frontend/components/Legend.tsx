"use client";

import { formatCount, formatKztShort } from "@/lib/format";
import { ROLE_HINT, ROLE_LABEL, ROLE_ORDER, roleColor } from "@/lib/roles";
import type { GraphStats } from "@/lib/graph";
import type { ColorMode } from "./GraphCanvas";

interface LegendProps {
  stats: GraphStats;
  visibleNodes: number;
  visibleLinks: number;
  colorMode: ColorMode;
}

export default function Legend({ stats, visibleNodes, visibleLinks, colorMode }: LegendProps) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 right-4 hidden max-w-[520px] flex-col gap-3 rounded-lg border border-edge bg-panel/90 px-4 py-3 text-xs lg:flex">
      {colorMode === "role" ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {ROLE_ORDER.map((role) => (
            <li key={role} className="flex items-center gap-2" title={ROLE_HINT[role]}>
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: roleColor(role) }}
              />
              <span className="text-ink">{ROLE_LABEL[role]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">
          Цвет узла — номер кластера. Роли смотрите в карточке узла и в списке приоритетов.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border border-ink bg-transparent"
          />
          seed-клиент
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-muted opacity-60"
          />
          обрыв выгрузки на 4-м колене
        </span>
        <span>размер — приоритет проверки</span>
      </div>

      <dl className="tabular grid grid-cols-4 gap-x-4 gap-y-1">
        <Metric label="узлов" value={`${formatCount(visibleNodes)} / ${formatCount(stats.nodeCount)}`} />
        <Metric label="связей" value={`${formatCount(visibleLinks)} / ${formatCount(stats.linkCount)}`} />
        <Metric label="оборот" value={formatKztShort(stats.turnover)} />
        <Metric label="обрывов" value={formatCount(stats.cutoffCount)} />
      </dl>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}
