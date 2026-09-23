"use client";

import { useMemo, useState } from "react";

import { ROLE_ORDER, roleColor, roleLabel } from "@/lib/roles";
import type { Role, TopItem } from "@/lib/types";

interface PriorityListProps {
  top: TopItem[];
  selectedId: number | null;
  onSelect: (gid: number) => void;
}

export default function PriorityList({ top, selectedId, onSelect }: PriorityListProps) {
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");

  // В фильтре показываем только те роли, которые реально встречаются в топе.
  const availableRoles = useMemo(() => {
    const present = new Set(top.map((item) => item.role));
    return ROLE_ORDER.filter((role) => present.has(role));
  }, [top]);

  const items = roleFilter === "all" ? top : top.filter((item) => item.role === roleFilter);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-edge p-3">
        <FilterChip active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>
          все роли
        </FilterChip>
        {availableRoles.map((role) => (
          <FilterChip key={role} active={roleFilter === role} onClick={() => setRoleFilter(role)}>
            <span
              aria-hidden
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: roleColor(role) }}
            />
            {roleLabel(role)}
          </FilterChip>
        ))}
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <li className="p-4 text-sm text-muted">
            В топ-{top.length} нет узлов с этой ролью. Выберите другую роль.
          </li>
        ) : (
          items.map((item) => (
            <li key={item.gid}>
              <button
                type="button"
                onClick={() => onSelect(item.gid)}
                className={`flex w-full flex-col gap-1.5 border-b border-edge/60 px-3 py-2.5 text-left transition-colors hover:bg-edge/40 ${
                  item.gid === selectedId ? "bg-edge/60" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="tabular w-6 shrink-0 text-sm text-muted">{item.rank}</span>
                  <span className="tabular break-all text-sm font-medium">{item.gid}</span>
                  <span className="ml-8 flex items-center gap-1.5 text-xs text-muted">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: roleColor(item.role) }}
                    />
                    {roleLabel(item.role)}
                  </span>
                </div>

                <div className="flex items-center gap-2 pl-6">
                  <span
                    className="h-1 flex-1 overflow-hidden rounded-full bg-edge"
                    role="presentation"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(2, item.priority_score * 100)}%`,
                        background: roleColor(item.role),
                      }}
                    />
                  </span>
                  <span className="tabular w-9 shrink-0 text-right text-xs text-muted">
                    {item.priority_score.toFixed(2)}
                  </span>
                </div>

                <p className="line-clamp-2 pl-6 text-xs leading-snug text-muted">{item.why}</p>
              </button>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active ? "border-muted bg-edge text-ink" : "border-edge text-muted hover:border-muted"
      }`}
    >
      {children}
    </button>
  );
}
