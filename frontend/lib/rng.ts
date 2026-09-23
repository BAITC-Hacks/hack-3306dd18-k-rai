/** Детерминированный PRNG: один и тот же seed — один и тот же граф при перезагрузке. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRandom(seed: number) {
  const next = mulberry32(seed);
  return {
    next,
    /** Целое в [min, max] включительно. */
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min: number, max: number): number {
      return min + next() * (max - min);
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
    /** k различных элементов (или все, если их меньше k). */
    sample<T>(items: readonly T[], k: number): T[] {
      const pool = items.slice();
      const taken: T[] = [];
      const n = Math.min(k, pool.length);
      for (let i = 0; i < n; i += 1) {
        const idx = Math.floor(next() * pool.length);
        taken.push(pool[idx]);
        pool.splice(idx, 1);
      }
      return taken;
    },
  };
}

export type Random = ReturnType<typeof makeRandom>;
