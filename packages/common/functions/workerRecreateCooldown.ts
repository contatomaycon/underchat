export const WORKER_RECREATE_COOLDOWN_SECONDS = 120;

export function getWorkerRecreateAvailableAt(now: Date = new Date()): string {
  return new Date(
    now.getTime() + WORKER_RECREATE_COOLDOWN_SECONDS * 1000
  ).toISOString();
}
