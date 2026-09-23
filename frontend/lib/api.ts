import { generateMockGraph, mockAsk } from "./mock";
import { normalizeAskResponse, normalizeGraphData } from "./normalize";
import type { AskRequest, AskResponse, GraphData } from "./types";

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const usingMocks = USE_MOCKS;

/** Таймаут действует и на чтение тела ответа; размонтирование отменяет запрос. */
async function requestJson(
  path: string,
  options: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(API_BASE + path, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Бэкенд ответил ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function fetchGraph(signal?: AbortSignal): Promise<GraphData> {
  if (USE_MOCKS) return generateMockGraph();
  return normalizeGraphData(await requestJson(
    "/api/graph", { headers: { Accept: "application/json" } }, 30_000, signal,
  ));
}

export async function askAgent(request: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
  if (USE_MOCKS) return mockAsk(request);
  return normalizeAskResponse(await requestJson("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
  }, 45_000, signal));
}
