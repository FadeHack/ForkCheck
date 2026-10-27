import type { Probe } from "./model/probe";

/** FNV-1a: a stable 32-bit hash of the seed string. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast and reproducible; not for anything secret. */
function random(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded generator: the same seed always gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const next = random(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The order one participant sees a probe's options in. Seeded by participant and probe,
 * so a reload shows the same order and simulated participants see what a real one would.
 */
export function optionOrder<P extends Pick<Probe, "id" | "options">>(
  probe: P,
  participantId: string,
): P {
  return { ...probe, options: seededShuffle(probe.options, `${participantId}\u0000${probe.id}`) };
}
