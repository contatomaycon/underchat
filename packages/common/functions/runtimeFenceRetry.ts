export type RuntimeFenceRandomSource = () => number;

export function runtimeFenceFullJitterDelayMs(
  capMs: number,
  random: RuntimeFenceRandomSource = Math.random
): number {
  const cap = Math.max(1, Math.floor(Number(capMs) || 0));
  const sample = Number(random());
  const boundedSample = Number.isFinite(sample)
    ? Math.min(Math.max(sample, 0), 1)
    : 0;

  return Math.min(cap, 1 + Math.floor(boundedSample * cap));
}

export async function waitRuntimeFenceRetry(
  capMs: number,
  random: RuntimeFenceRandomSource = Math.random
): Promise<void> {
  const delayMs = runtimeFenceFullJitterDelayMs(capMs, random);
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
