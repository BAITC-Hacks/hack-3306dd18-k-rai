"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * prefers-reduced-motion отключает частицы и анимацию раскрытия колен.
 * Подписка через useSyncExternalStore, а не useState + useEffect: значение
 * читается сразу при первом рендере и не вызывает лишнего каскада.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // На сервере медиазапросов нет; при статическом экспорте это первый кадр.
    () => false,
  );
}
