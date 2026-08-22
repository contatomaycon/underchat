import { BuildEnvironment } from '@core/config/environments/BuildEnvironment';

describe('BuildEnvironment rollout safety defaults', () => {
  const optionalKeys = [
    'WORKER_IMAGE_PROVISION_TIMEOUT_MS',
    'WORKER_IMAGE_DEFAULT_CACHE_TTL_MS',
    'WORKER_IMAGE_RECONCILE_INTERVAL_MS',
    'BALANCE_IMAGE_ROLLOUT_ENABLED',
    'BALANCE_IMAGE_ROLLOUT_APPROVED_DIGEST',
    'BALANCE_IMAGE_ROLLOUT_SERVER_IDS',
    'BALANCE_IMAGE_ROLLOUT_READINESS_TIMEOUT_MS',
    'BALANCE_IMAGE_ROLLOUT_STABILITY_WINDOW_MS',
    'BALANCE_IMAGE_ROLLOUT_RETRY_COOLDOWN_MS',
    'BALANCE_IMAGE_ROLLOUT_COMMAND_TIMEOUT_MS',
  ] as const;
  const originalEnvironment = new Map(
    optionalKeys.map((key) => [key, process.env[key]])
  );

  afterEach(() => {
    for (const key of optionalKeys) {
      const value = originalEnvironment.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('boots with every new rollout environment absent and keeps mutations opt-in', () => {
    optionalKeys.forEach((key) => delete process.env[key]);
    const environment = new BuildEnvironment();

    expect(environment.workerImageProvisionTimeoutMs).toBe(300_000);
    expect(environment.workerImageDefaultCacheTtlMs).toBe(3_000);
    expect(environment.workerImageReconcileIntervalMs).toBe(30_000);
    expect(environment.balanceImageRolloutEnabled).toBe(false);
    expect(environment.balanceImageRolloutApprovedDigest).toBeNull();
    expect(environment.balanceImageRolloutServerIds).toEqual([]);
    expect(environment.balanceImageRolloutReadinessTimeoutMs).toBe(420_000);
    expect(environment.balanceImageRolloutStabilityWindowMs).toBe(120_000);
    expect(environment.balanceImageRolloutRetryCooldownMs).toBe(900_000);
    expect(environment.balanceImageRolloutCommandTimeoutMs).toBe(900_000);
  });
});
