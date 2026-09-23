/**
 * Проверка разбора markdown в ответе агента на реальном тексте модели.
 * Запуск: npx tsx scripts/check-markdown.tsx [путь к ask-live.json]
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import AnswerText from "../components/AnswerText";

const path = process.argv[2];
const answer = path
  ? String(JSON.parse(readFileSync(path, "utf8")).answer ?? "")
  : [
      "Деньги уходят к получателям. Основные данные:",
      "",
      "1. **gid: 100000002241986100**",
      "   - Вход: 280,000 ₸",
      "   - Роль: peripheral",
      "",
      "2. **gid: 100000003888197100**",
      "   - Выход: 0 ₸",
      "",
      "Затронутые gid:",
      "- 100000002241986100",
      "- 100000003888197100",
    ].join("\n");

// В графе «есть» только те gid, что встречаются в самом тексте — так проверяем,
// что неизвестные номера не превращаются в мёртвые кнопки.
const uniqueGids = [...new Set((answer.match(/\d{15,20}/g) ?? []).map(Number))];
const known = new Set(uniqueGids.slice(0, -1));

const html = renderToStaticMarkup(
  <AnswerText text={answer} onGidClick={() => {}} isKnownGid={(gid) => known.has(gid)} />,
);

const count = (needle: string) => html.split(needle).length - 1;

const checks: [string, boolean][] = [
  ["исходный текст не пустой", answer.trim().length > 0],
  ["жирный текст стал <strong>", count("<strong") > 0],
  ["звёздочки ** не просочились в вывод", !html.includes("**")],
  ["нумерованный список стал <ol>", count("<ol") > 0],
  ["маркированный список стал <ul>", count("<ul") > 0],
  ["пункты списка отрисованы", count("<li") >= 2],
  ["абзацы отрисованы", count("<p") > 0],
  ["известные gid стали кнопками", count("<button") > 0],
  ["неизвестный gid кнопкой не стал", count("<button") < (answer.match(/\d{15,20}/g) ?? []).length],
  ["разметка не содержит сырых переводов строк в тексте", !html.includes("\\n")],
];

// Регрессии: компактный ответ из чата, пустые строки между пунктами,
// смешанные списки, gid внутри форматирования и экранирование HTML.
const render = (text: string) => renderToStaticMarkup(
  <AnswerText
    text={text}
    onGidClick={() => {}}
    isKnownGid={(gid) => gid === Number("100000000331309100")}
  />,
);
const occurrences = (text: string, token: string) => text.split(token).length - 1;
const compact = render(
  "Гипотезы: 1. **Признак высокой активности**: Выход — 23 001 375 ₸. " +
  "2. **Гипотеза о расширенном взаимодействии**: Выплаты 99 получателям. " +
  "3. **Признак множественных источников**: 5 отправителей. " +
  "Затронутые gid: - 100000000331309100 (основной узел) - 100000004403675100",
);
const spaced = render("1. **Первый**\n   - Вложенный пункт\n\n2. **Второй**");
const mixed = render("1. Первый\n2. Второй\n- Маркер\n- Ещё маркер");
const formattedGids = render("**100000000331309100** и **100000004403675100**");
const plain = render("На 1. **июля** оборот 23 001 375 ₸. Доля 0.35, пункт 2.1.");
const escaped = render('<img src=x onerror="alert(1)"> **Текст**');
const continued = render("1. Начало\n   продолжение\n2. Следующий");
checks.push(
  ["компактный ответ стал двумя списками с пятью пунктами",
    occurrences(compact, "<ol") === 1 && occurrences(compact, "<ul") === 1 && occurrences(compact, "<li") === 5],
  ["пустые строки не сбрасывают нумерацию и сохраняют вложенность",
    occurrences(spaced, "<ol") === 1 && /<li[^>]*>.*<ul/.test(spaced)],
  ["тип списка меняется с нумерованного на маркированный",
    occurrences(mixed, "<ol") === 1 && occurrences(mixed, "<ul") === 1],
  ["номер первого пункта сохраняется", render("3. Третий\n4. Четвёртый").includes('start="3"')],
  ["gid внутри жирного текста кликабелен только для известного узла",
    occurrences(formattedGids, "<button") === 1 && /<strong[^>]*><button/.test(formattedGids)],
  ["обычные числа и суммы не превращаются в списки",
    !plain.includes("<ol") && plain.includes("23 001 375") && plain.includes("2.1.")],
  ["HTML из ответа остаётся текстом",
    !escaped.includes("<img") && escaped.includes("&lt;img") && escaped.includes("<strong")],
  ["продолжение пункта остаётся в списке",
    continued.includes("Начало продолжение</li>") && occurrences(continued, "<li") === 2],
  ["пустой ответ имеет подсказку", render("  \n").includes("Агент вернул пустой ответ.")],
  ["заголовок и код отображаются", render("# Итог\n\n" + String.fromCharCode(96) + "sum_in" + String.fromCharCode(96)).includes("<code")],
);

console.log(`длина ответа: ${answer.length} символов`);
console.log(`gid в тексте: ${(answer.match(/\d{15,20}/g) ?? []).length}, из них кликабельных: ${count("<button")}`);
console.log(`блоков: <p> ${count("<p")}, <ol> ${count("<ol")}, <ul> ${count("<ul")}, <li> ${count("<li")}, <strong> ${count("<strong")}\n`);

let failed = 0;
checks.forEach(([label, ok]) => {
  console.log(`${ok ? "OK " : "ПРОВАЛ"} ${label}`);
  if (!ok) failed += 1;
});

console.log("\n--- первые 400 символов разметки ---");
console.log(html.slice(0, 400));

if (failed > 0) {
  console.error(`\nПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log("\nOK: markdown разбирается корректно");
