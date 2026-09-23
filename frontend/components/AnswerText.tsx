"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Минимальный разбор markdown в ответе агента: заголовки, списки, жирный текст,
 * моноширинные вставки. Плюс главное для этого экрана — gid в тексте становятся
 * кликабельными, и аналитик переходит к узлу прямо из ответа.
 *
 * Собираем React-элементы, а не HTML-строку: текст приходит из LLM через бэкенд,
 * и dangerouslySetInnerHTML здесь был бы дырой для внедрения разметки.
 */

interface AnswerTextProps {
  text: string;
  /** Переход к узлу по клику на gid в тексте. */
  onGidClick?: (gid: number) => void;
  /** gid делается ссылкой, только если такой узел есть в графе. */
  isKnownGid?: (gid: number) => boolean;
}

/** Пункт списка может содержать вложенные списки — модель пишет подпункты с отступом. */
interface ListItem {
  text: string;
  children: ListBlock[];
}

interface ListBlock {
  ordered: boolean;
  start: number;
  items: ListItem[];
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; list: ListBlock };

const HEADING = /^(#{1,4})\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;

/**
 * Некоторые ответы приходят одной строкой. Восстанавливаем только явные
 * последовательности «1. **…** 2. **…**» и списки gid, не обычные числа в тексте.
 * Строки с кодом оставляем как есть.
 */
function restoreCompactLists(source: string): string {
  return source.split(/\r\n?|\n/).map((line) => {
    if (line.includes("`")) return line;

    const numbered = [...line.matchAll(/(?:^|[ \t])(\d{1,3})[.)][ \t]+(?=(?:\*\*|__)\S)/g)];
    let result = line;
    if (numbered.length > 1 && numbered.every((match, index) => Number(match[1]) === index + 1)) {
      result = result.replace(/[ \t]+(?=\d{1,3}[.)][ \t]+(?:\*\*|__)\S)/g, "\n");
    }

    const gids = [...line.matchAll(/[ \t]+[-*•][ \t]+(?=\d{15,20}\b)/g)];
    if (gids.length > 1) {
      result = result
        .replace(/[ \t]+(?=Затронутые[ \t]+gid:)/gi, "\n\n")
        .replace(/[ \t]+(?=[-*•][ \t]+\d{15,20}\b)/g, "\n");
    }
    return result;
  }).join("\n");
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  // Стек открытых уровней вложенности: верхушка — самый глубокий список.
  let stack: { depth: number; block: ListBlock }[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    stack = [];
  };

  const addItem = (depth: number, ordered: boolean, text: string, start = 1) => {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.depth < depth || (top.depth === depth && top.block.ordered === ordered)) break;
      stack.pop();
    }

    const top = stack[stack.length - 1];
    if (!top) {
      const block: ListBlock = { ordered, start, items: [{ text, children: [] }] };
      stack.push({ depth, block });
      blocks.push({ kind: "list", list: block });
      return;
    }

    if (top.depth === depth) {
      top.block.items.push({ text, children: [] });
      return;
    }

    // Глубже текущего уровня — вкладываем список в последний пункт.
    const parent = top.block.items[top.block.items.length - 1];
    const child: ListBlock = { ordered, start, items: [{ text, children: [] }] };
    parent.children.push(child);
    stack.push({ depth, block: child });
  };

  for (const rawLine of restoreCompactLists(source).split("\n")) {
    const line = rawLine.trimEnd();

    if (line.trim() === "") {
      flushParagraph();
      // Пустая строка между пунктами не должна начинать нумерацию заново.
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);
    const item = ordered ?? bullet;
    if (item) {
      flushParagraph();
      // Вложенность считаем по отступу: модель пишет подпункты с 2–4 пробелами.
      const depth = Math.floor(item[1].replace(/\t/g, "  ").length / 2);
      addItem(depth, Boolean(ordered), ordered ? ordered[3] : item[2], ordered ? Number(ordered[2]) : 1);
      continue;
    }

    const current = stack[stack.length - 1];
    const indent = line.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
    if (current && indent >= (current.depth + 1) * 2) {
      const lastItem = current.block.items[current.block.items.length - 1];
      lastItem.text += " " + line.trim();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

// Порядок важен: **жирный** должен разбираться раньше *курсива*.
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|`[^`]+`|\d{15,20})/g;

function renderInline(
  text: string,
  onGidClick?: (gid: number) => void,
  isKnownGid?: (gid: number) => boolean,
): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part !== "");

  return parts.map((part, index) => {
    const key = `${index}-${part.slice(0, 8)}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {renderInline(part.slice(2, -2), onGidClick, isKnownGid)}
        </strong>
      );
    }
    if (part.startsWith("__") && part.endsWith("__")) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {renderInline(part.slice(2, -2), onGidClick, isKnownGid)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{renderInline(part.slice(1, -1), onGidClick, isKnownGid)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="tabular rounded bg-edge/60 px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }

    if (/^\d{15,20}$/.test(part)) {
      const gid = Number(part);
      // Ссылкой делаем только существующий узел — мёртвых кнопок быть не должно.
      if (onGidClick && (!isKnownGid || isKnownGid(gid))) {
        return (
          <button
            key={key}
            type="button"
            onClick={() => onGidClick(gid)}
            className="tabular underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
            title="Перейти к узлу"
          >
            {part}
          </button>
        );
      }
      return (
        <span key={key} className="tabular">
          {part}
        </span>
      );
    }

    return <Fragment key={key}>{part}</Fragment>;
  });
}

function renderList(
  list: ListBlock,
  keyPrefix: string,
  onGidClick?: (gid: number) => void,
  isKnownGid?: (gid: number) => boolean,
): ReactNode {
  const ListTag = list.ordered ? "ol" : "ul";
  return (
    <ListTag
      key={keyPrefix}
      start={list.ordered && list.start !== 1 ? list.start : undefined}
      className={`flex flex-col gap-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}
    >
      {list.items.map((item, index) => (
        <li key={`${keyPrefix}-${index}`}>
          {renderInline(item.text, onGidClick, isKnownGid)}
          {item.children.map((child, childIndex) =>
            renderList(child, `${keyPrefix}-${index}-${childIndex}`, onGidClick, isKnownGid),
          )}
        </li>
      ))}
    </ListTag>
  );
}

export default function AnswerText({ text, onGidClick, isKnownGid }: AnswerTextProps) {
  const blocks = parseBlocks(text);

  if (blocks.length === 0) {
    return <p className="text-sm leading-relaxed text-muted">Агент вернул пустой ответ.</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5 break-words text-sm leading-relaxed">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h4 key={index} className="text-xs uppercase tracking-wide text-muted">
              {renderInline(block.text, onGidClick, isKnownGid)}
            </h4>
          );
        }

        if (block.kind === "list") {
          return renderList(block.list, `list-${index}`, onGidClick, isKnownGid);
        }

        return <p key={index}>{renderInline(block.text, onGidClick, isKnownGid)}</p>;
      })}
    </div>
  );
}
