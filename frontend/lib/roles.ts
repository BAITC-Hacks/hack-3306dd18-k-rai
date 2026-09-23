import type { Role } from "./types";

export const ROLE_ORDER: Role[] = [
  "consolidator",
  "coordinator",
  "distributor",
  "transit",
  "terminal",
  "peripheral",
];

export const ROLE_LABEL: Record<Role, string> = {
  consolidator: "консолидатор",
  coordinator: "координатор",
  distributor: "распределитель",
  transit: "транзит",
  terminal: "конечный получатель",
  peripheral: "периферия",
};

export const ROLE_COLOR: Record<Role, string> = {
  consolidator: "#FF5A5F",
  coordinator: "#C77DFF",
  distributor: "#FFB547",
  transit: "#4CC9F0",
  terminal: "#57CC99",
  peripheral: "#5C6F87",
};

/** Короткое пояснение роли для легенды и подсказок. */
export const ROLE_HINT: Record<Role, string> = {
  consolidator: "признаки консолидации: получает от многих, отдаёт мало",
  coordinator: "сходятся потоки из цепочек нескольких seed-клиентов",
  distributor: "веерная рассылка на много получателей",
  transit: "пропускает почти всё полученное дальше",
  terminal: "деньги пришли и остались, выгрузка не обрывалась",
  peripheral: "выраженных признаков роли не выявлено",
};

export function roleLabel(role: Role): string {
  return ROLE_LABEL[role] ?? String(role);
}

export function roleColor(role: Role): string {
  return ROLE_COLOR[role] ?? ROLE_COLOR.peripheral;
}

/**
 * Цвет кластера в режиме «Цвет: кластеры». Кластеров может быть и шесть, и под сотню
 * (в реальной выгрузке их 91), поэтому вместо фиксированной палитры берём оттенок
 * по золотому углу: соседние номера всегда получают заметно разный цвет.
 */
export function clusterColor(clusterId: number): string {
  const hue = (Math.abs(Math.round(clusterId)) * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 62%, 62%)`;
}
