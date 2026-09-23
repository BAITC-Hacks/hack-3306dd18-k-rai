"use client";

import { useRef, type ReactNode } from "react";

export type TabId = "priorities" | "node" | "agent";

const TABS: { id: TabId; label: string }[] = [
  { id: "priorities", label: "Приоритеты" },
  { id: "node", label: "Узел" },
  { id: "agent", label: "Агент" },
];

interface SidePanelProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  priorities: ReactNode;
  node: ReactNode;
  agent: ReactNode;
}

export default function SidePanel({ activeTab, onTabChange, priorities, node, agent }: SidePanelProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <aside className="flex h-[55dvh] min-h-[360px] w-full min-w-0 shrink-0 flex-col border-t border-edge bg-panel md:h-full md:min-h-0 md:w-[400px] md:border-l md:border-t-0">
      <div role="tablist" aria-label="Панель аналитика" className="flex shrink-0 border-b border-edge">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            ref={(element) => { tabRefs.current[index] = element; }}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onKeyDown={(event) => {
              const next = event.key === "ArrowRight" ? (index + 1) % TABS.length
                : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
                : event.key === "Home" ? 0
                : event.key === "End" ? TABS.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              onTabChange(TABS[next].id);
              tabRefs.current[next]?.focus();
            }}
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? "border-b-ink text-ink"
                : "border-b-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Все вкладки остаются смонтированными: иначе ответ агента и фильтр ролей
          сбрасывались бы при каждом переключении. */}
      <Panel id="priorities" activeTab={activeTab}>
        {priorities}
      </Panel>
      <Panel id="node" activeTab={activeTab}>
        {node}
      </Panel>
      <Panel id="agent" activeTab={activeTab}>
        {agent}
      </Panel>
    </aside>
  );
}

function Panel({ id, activeTab, children }: { id: TabId; activeTab: TabId; children: ReactNode }) {
  const active = id === activeTab;
  // Прокруткой управляет содержимое вкладки — так фильтр ролей остаётся на месте.
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      hidden={!active}
      tabIndex={0}
      className={active ? "min-h-0 min-w-0 flex-1 overflow-hidden" : "hidden"}
    >
      {children}
    </div>
  );
}
