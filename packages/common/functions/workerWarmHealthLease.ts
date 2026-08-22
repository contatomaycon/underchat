import { IWorkerWarmPoolSettings } from '../interfaces/IWorkerWarmPoolSettings';

const MINIMUM_WARM_HEALTH_LEASE_MS = 60_000;
const WARM_HEALTH_LEASE_SCAN_MULTIPLIER = 3;

export function getWorkerWarmHealthLeaseDurationMs(
  settings: Pick<IWorkerWarmPoolSettings, 'scan_interval_seconds'>
): number {
  const scanIntervalSeconds = Number(settings.scan_interval_seconds);
  const normalizedScanIntervalMs =
    Number.isFinite(scanIntervalSeconds) && scanIntervalSeconds > 0
      ? Math.floor(scanIntervalSeconds * 1_000)
      : MINIMUM_WARM_HEALTH_LEASE_MS;

  return Math.max(
    MINIMUM_WARM_HEALTH_LEASE_MS,
    normalizedScanIntervalMs * WARM_HEALTH_LEASE_SCAN_MULTIPLIER
  );
}

export function getWorkerWarmHealthFreshAfter(
  settings: Pick<IWorkerWarmPoolSettings, 'scan_interval_seconds'>,
  nowMs: number = Date.now()
): string {
  return new Date(
    nowMs - getWorkerWarmHealthLeaseDurationMs(settings)
  ).toISOString();
}
