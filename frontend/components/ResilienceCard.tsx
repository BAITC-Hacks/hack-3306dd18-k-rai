"use client";

import { formatCount, formatKztShort, formatPercent, plural } from "@/lib/format";
import type { NetworkState } from "@/lib/resilience";

interface ResilienceCardProps {
  removedCount: number;
  before: NetworkState;
  after: NetworkState;
  turnoverShare: number;
  onRestore: () => void;
}

export default function ResilienceCard({
  removedCount,
  before,
  after,
  turnoverShare,
  onRestore,
}: ResilienceCardProps) {
  return (
    <div className="absolute right-4 top-4 max-h-[calc(100%-2rem)] w-[300px] max-w-[calc(100%-2rem)] overflow-y-auto rounded-lg border border-edge bg-panel/95 p-4 text-xs">
      <h2 className="mb-3 text-sm font-medium">
        Изъято {formatCount(removedCount)} {plural(removedCount, "узел", "узла", "узлов")}
      </h2>

      <dl className="flex flex-col gap-2.5">
        <Row
          label="слабосвязных компонент"
          before={formatCount(before.components)}
          after={formatCount(after.components)}
          grew={after.components > before.components}
        />
        <Row
          label="крупнейшая компонента"
          before={formatCount(before.largestComponent)}
          after={formatCount(after.largestComponent)}
          grew={false}
        />
        <Row
          label="связей в сети"
          before={formatCount(before.links)}
          after={formatCount(after.links)}
          grew={false}
        />
        <Row
          label="оборот в сети"
          before={formatKztShort(before.turnover)}
          after={formatKztShort(after.turnover)}
          grew={false}
        />
      </dl>

      <p className="mt-3 leading-relaxed text-muted">
        Через изъятые узлы проходило{" "}
        <span className="tabular text-ink">{formatPercent(turnoverShare, 1)}</span> оборота графа.
        Крупнейшая компонента уменьшилась на{" "}
        <span className="tabular text-ink">
          {formatCount(before.largestComponent - after.largestComponent)}
        </span>{" "}
        {plural(before.largestComponent - after.largestComponent, "узел", "узла", "узлов")}.
      </p>

      <button
        type="button"
        onClick={onRestore}
        className="mt-3 w-full rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:border-muted"
      >
        Вернуть
      </button>
    </div>
  );
}

function Row({
  label,
  before,
  after,
  grew,
}: {
  label: string;
  before: string;
  after: string;
  grew: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular flex shrink-0 items-baseline gap-1.5">
        <span className="text-muted">{before}</span>
        <span aria-label="становится" className="text-muted">
          →
        </span>
        <span className={grew ? "text-role-consolidator" : "text-ink"}>{after}</span>
      </dd>
    </div>
  );
}
