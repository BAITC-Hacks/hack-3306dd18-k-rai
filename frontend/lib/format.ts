/** 1 250 000 ₸ */
export function formatKzt(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

/** Компактно, для счётчиков в шапке: 365,9 млн ₸ */
export function formatKztShort(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млрд ₸`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн ₸`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} тыс ₸`;
  return formatKzt(value);
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toLocaleString("ru-RU", { maximumFractionDigits: digits })}%`;
}

/** Склонение: 1 узел, 2 узла, 5 узлов */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
