"use client";

import { useEffect, useRef, useState } from "react";

import AnswerText from "@/components/AnswerText";
import { askAgent } from "@/lib/api";
import type { AgentStep, AskResponse } from "@/lib/types";

/** Названия инструментов агента переводим в человеческие фразы. */
const TOOL_LABEL: Record<string, string> = {
  get_node: "Изучил узел",
  get_senders: "Посмотрел, кто платил",
  get_receivers: "Посмотрел, кому платил",
  common_receivers: "Искал общих получателей",
  trace_downstream: "Проследил деньги дальше",
  cluster_summary: "Изучил кластер",
  graph_top: "Посмотрел топ приоритетов",
  graph_stats: "Посчитал статистику графа",
};

const FAILURE_TEXT =
  "Агент не ответил. Граф и роли работают без него — попробуйте переформулировать вопрос.";

/** Сколько узлов из ответа показывать чипами: бэкенд может прислать и сотню. */
const MAX_HIGHLIGHT_CHIPS = 24;

interface AgentPanelProps {
  question: string;
  onQuestionChange: (value: string) => void;
  markedGids: number[];
  onUnmark: (gid: number) => void;
  onClearMarks: () => void;
  onAnswer: (highlightGids: number[]) => void;
  onGoToNode: (gid: number) => void;
  isKnownGid: (gid: number) => boolean;
}

export default function AgentPanel({
  question,
  onQuestionChange,
  markedGids,
  onUnmark,
  onClearMarks,
  onAnswer,
  onGoToNode,
  isKnownGid,
}: AgentPanelProps) {
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAllHighlights, setShowAllHighlights] = useState(false);

  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const suggestions = [
    "Кто собирает деньги с выбранных узлов?",
    "Какой кластер выглядит опаснее всего и почему?",
    markedGids.length > 0
      ? `Куда уходят деньги от узла ${markedGids[0]}?`
      : "Куда уходят деньги от узла с первого места в топе?",
  ];

  async function submit() {
    const text = question.trim();
    if (text === "" || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;

    setPending(true);
    setFailed(false);
    setResponse(null);
    setShowAllHighlights(false);
    onAnswer([]);
    try {
      const result = await askAgent({ question: text, selected_gids: markedGids }, controller.signal);
      if (controller.signal.aborted) return;
      const highlights = [...new Set(result.highlight_gids)].filter(isKnownGid);
      if (result.error) {
        setFailed(true);
      } else {
        setResponse({ ...result, highlight_gids: highlights });
        onAnswer(highlights);
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto break-words p-4" aria-busy={pending}>
      <div>
        <label htmlFor="agent-question" className="mb-1.5 block text-xs uppercase tracking-wide text-muted">
          Вопрос агенту
        </label>
        <textarea
          id="agent-question"
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={3}
          placeholder="Например: кто собирает деньги с этих узлов?"
          className="w-full resize-none rounded-md border border-edge bg-canvas px-3 py-2 text-sm outline-none placeholder:text-muted/70 focus:border-muted"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((hint) => (
          <button
            key={hint}
            type="button"
            onClick={() => onQuestionChange(hint)}
            className="rounded-full border border-edge px-2.5 py-1 text-left text-xs text-muted transition-colors hover:border-muted hover:text-ink"
          >
            {hint}
          </button>
        ))}
      </div>

      <section>
        <h3 className="mb-1.5 flex items-baseline justify-between text-xs uppercase tracking-wide text-muted">
          <span>Выделенные узлы</span>
          {markedGids.length > 0 ? (
            <button type="button" className="normal-case underline" onClick={onClearMarks}>
              снять всё
            </button>
          ) : null}
        </h3>

        {markedGids.length === 0 ? (
          <p className="text-xs text-muted">
            Shift + клик по узлам на схеме добавляет их в вопрос.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {markedGids.map((gid) => (
              <li key={gid}>
                <span className="tabular inline-flex items-center gap-1.5 rounded-full border border-edge px-2 py-1 text-xs">
                  <button type="button" onClick={() => onGoToNode(gid)} className="hover:underline">
                    {gid}
                  </button>
                  <button
                    type="button"
                    aria-label={`Убрать узел ${gid} из выделения`}
                    onClick={() => onUnmark(gid)}
                    className="text-muted hover:text-ink"
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={pending || question.trim() === ""}
        className="rounded-md border border-edge px-3 py-2 text-sm transition-colors hover:border-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Агент исследует граф…" : "Спросить"}
      </button>

      {failed ? (
        <p role="alert" className="rounded-md border border-edge p-3 text-sm leading-relaxed text-muted">{FAILURE_TEXT}</p>
      ) : null}

      {response ? (
        <div className="flex flex-col gap-4">
          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Что сделал агент</h3>
            <ol className="flex list-decimal flex-col gap-2 pl-5 marker:text-muted">
              {response.steps.map((step, position) => (
                <li key={`${step.tool}-${position}`} className="pl-1 text-sm">
                  <span>
                    <span className="text-ink">{stepTitle(step)}</span>
                    {step.summary ? <span className="text-muted"> — {step.summary}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {response.mode && response.mode !== "llm" ? (
            <p className="rounded-md border border-dashed border-edge p-3 text-xs leading-relaxed text-muted">
              Модель не отработала{response.llm_error ? `: ${response.llm_error}` : ""}. Ответ собран
              запасным режимом бэкенда — проверьте выводы по графу.
            </p>
          ) : null}

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Ответ</h3>
            <AnswerText
              text={response.answer}
              onGidClick={onGoToNode}
              isKnownGid={isKnownGid}
            />
          </section>

          {response.highlight_gids.length > 0 ? (
            <section>
              <h3 className="mb-2 flex items-baseline justify-between text-xs uppercase tracking-wide text-muted">
                <span>Узлы в ответе</span>
                {response.highlight_gids.length > MAX_HIGHLIGHT_CHIPS ? (
                  <button
                    type="button"
                    className="tabular normal-case underline"
                    onClick={() => setShowAllHighlights((current) => !current)}
                  >
                    {showAllHighlights
                      ? "свернуть"
                      : `показаны ${MAX_HIGHLIGHT_CHIPS} из ${response.highlight_gids.length}`}
                  </button>
                ) : null}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {(showAllHighlights
                  ? response.highlight_gids
                  : response.highlight_gids.slice(0, MAX_HIGHLIGHT_CHIPS)
                ).map((gid) => (
                  <li key={gid}>
                    <button
                      type="button"
                      onClick={() => onGoToNode(gid)}
                      className="tabular rounded-full border border-edge px-2 py-1 text-xs transition-colors hover:border-muted"
                    >
                      {gid}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function stepTitle(step: AgentStep): string {
  return TOOL_LABEL[step.tool] ?? step.tool;
}
