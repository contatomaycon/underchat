import 'reflect-metadata';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import type {
  ActiveWorkerImageDrift,
  ActiveWwebjsRuntimeSafetyDrift,
  WorkerService,
} from '@core/services/worker.service';
import { WorkerImageReconcilerService } from '@core/services/workerImageReconciler.service';

const IMAGE_ID_BY_ALIAS = new Map<EWorkerImage, string>([
  [EWorkerImage.baileys, `sha256:${'1'.repeat(64)}`],
  [EWorkerImage.wwebjs, `sha256:${'2'.repeat(64)}`],
  [EWorkerImage.whatsmeow, `sha256:${'3'.repeat(64)}`],
]);

const IMAGE_DRIFT: ActiveWorkerImageDrift = {
  account_id: '019fa9dd-aa71-707f-9b82-0f3066e5849a',
  alias: EWorkerImage.wwebjs,
  container_id: '4'.repeat(64),
  current_content_id: `sha256:${'5'.repeat(64)}`,
  expected_content_id: IMAGE_ID_BY_ALIAS.get(EWorkerImage.wwebjs) as string,
  runtime_generation: 9,
  server_id: '019f7020-9db0-778c-95cb-844c2844cae2',
  worker_id: '019faaa1-abea-7007-ad48-0f9c39e0a4f7',
};

const WWEBJS_SAFETY_DRIFT: ActiveWwebjsRuntimeSafetyDrift = {
  ...IMAGE_DRIFT,
  safety_reasons: ['image_mismatch', 'tini_missing', 'pids_limit_missing'],
};

function successfulResult(alias: EWorkerImage): {
  alias: EWorkerImage;
  contentId: string;
  desiredReference: string;
} {
  return {
    alias,
    contentId: IMAGE_ID_BY_ALIAS.get(alias) as string,
    desiredReference: `${alias.split(':')[0]}:test-candidate`,
  };
}

function buildHarness(options?: {
  ensureImage?: jest.Mock;
  listActiveWorkerImageDrifts?: jest.Mock;
  listActiveWwebjsRuntimeSafetyDrifts?: jest.Mock;
}): {
  ensureImage: jest.Mock;
  listActiveWorkerImageDrifts: jest.Mock;
  listActiveWwebjsRuntimeSafetyDrifts: jest.Mock;
  service: WorkerImageReconcilerService;
} {
  const ensureImage =
    options?.ensureImage ??
    jest.fn(async (alias: EWorkerImage) => successfulResult(alias));
  const listActiveWorkerImageDrifts =
    options?.listActiveWorkerImageDrifts ?? jest.fn(async () => []);
  const listActiveWwebjsRuntimeSafetyDrifts =
    options?.listActiveWwebjsRuntimeSafetyDrifts ?? jest.fn(async () => []);

  return {
    ensureImage,
    listActiveWorkerImageDrifts,
    listActiveWwebjsRuntimeSafetyDrifts,
    service: new WorkerImageReconcilerService(
      { ensureImage } as never,
      {
        listActiveWorkerImageDrifts,
        listActiveWwebjsRuntimeSafetyDrifts,
      } as unknown as WorkerService
    ),
  };
}

describe('WorkerImageReconcilerService manual-only contract', () => {
  const originalEnvironment = {
    active: process.env.WORKER_IMAGE_ACTIVE_ROLLOUT_ENABLED,
    interval: process.env.WORKER_IMAGE_RECONCILE_INTERVAL_MS,
    wwebjsSafety: process.env.WORKER_WWEBJS_SAFETY_MIGRATION_ENABLED,
  };

  beforeEach(() => {
    /*
     * These legacy flags deliberately remain hostile in every test. A stale
     * deployment setting must not restore automatic active-channel rollout.
     */
    process.env.WORKER_IMAGE_ACTIVE_ROLLOUT_ENABLED = 'true';
    process.env.WORKER_WWEBJS_SAFETY_MIGRATION_ENABLED = 'true';
    process.env.WORKER_IMAGE_RECONCILE_INTERVAL_MS = '5000';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore('WORKER_IMAGE_ACTIVE_ROLLOUT_ENABLED', originalEnvironment.active);
    restore('WORKER_IMAGE_RECONCILE_INTERVAL_MS', originalEnvironment.interval);
    restore(
      'WORKER_WWEBJS_SAFETY_MIGRATION_ENABLED',
      originalEnvironment.wwebjsSafety
    );
  });

  it('provisions and observes image drift without enqueuing an active channel', async () => {
    const harness = buildHarness({
      listActiveWorkerImageDrifts: jest.fn(async () => [IMAGE_DRIFT]),
      listActiveWwebjsRuntimeSafetyDrifts: jest.fn(async () => [
        WWEBJS_SAFETY_DRIFT,
      ]),
    });

    await harness.service.reconcileNow();

    expect(harness.ensureImage).toHaveBeenCalledTimes(3);
    expect(harness.listActiveWorkerImageDrifts).toHaveBeenCalledWith(
      Object.fromEntries(IMAGE_ID_BY_ALIAS)
    );
    expect(harness.listActiveWwebjsRuntimeSafetyDrifts).toHaveBeenCalledWith(
      IMAGE_ID_BY_ALIAS.get(EWorkerImage.wwebjs)
    );
    expect(harness.service.getStatus()).toEqual(
      expect.objectContaining({
        active_drift_count: 1,
        active_rollout_enabled: false,
        active_wwebjs_safety_drift_count: 1,
        last_rollout_at: null,
        last_rollout_outcome: 'manual_only',
        last_rollout_worker_id: null,
        last_wwebjs_safety_migration_at: null,
        last_wwebjs_safety_migration_outcome: 'manual_only',
        last_wwebjs_safety_migration_reasons:
          WWEBJS_SAFETY_DRIFT.safety_reasons,
        last_wwebjs_safety_migration_worker_id: WWEBJS_SAFETY_DRIFT.worker_id,
        wwebjs_safety_migration_enabled: false,
      })
    );
  });

  it('coalesces concurrent reconciliation into one read-only observation pass', async () => {
    let releaseFirst: () => void = () => undefined;
    const ensureImage = jest.fn(async (alias: EWorkerImage) => {
      if (alias !== EWorkerImage.baileys) {
        return successfulResult(alias);
      }
      return new Promise<ReturnType<typeof successfulResult>>((resolve) => {
        releaseFirst = () => resolve(successfulResult(alias));
      });
    });
    const harness = buildHarness({ ensureImage });

    const first = harness.service.reconcileNow();
    const second = harness.service.reconcileNow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(ensureImage).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([first, second]);

    expect(ensureImage).toHaveBeenCalledTimes(3);
    expect(harness.listActiveWorkerImageDrifts).toHaveBeenCalledTimes(1);
    expect(harness.listActiveWwebjsRuntimeSafetyDrifts).toHaveBeenCalledTimes(
      1
    );
    expect(harness.service.getStatus()).toEqual(
      expect.objectContaining({
        is_reconciling: false,
        last_rollout_outcome: 'no_drift',
        last_success_at: expect.any(String),
        last_wwebjs_safety_migration_outcome: 'no_drift',
      })
    );
  });

  it('keeps per-alias observability without exposing arbitrary error text', async () => {
    const ensureImage = jest.fn(async (alias: EWorkerImage) => {
      if (alias === EWorkerImage.wwebjs) {
        throw new Error('registry-password-should-not-appear');
      }
      return successfulResult(alias);
    });
    const harness = buildHarness({ ensureImage });

    await harness.service.reconcileNow();

    expect(harness.service.getStatus().aliases[EWorkerImage.wwebjs]).toEqual(
      expect.objectContaining({
        content_id: null,
        error_code: 'worker_image_reconcile_failed',
        last_attempt_at: expect.any(String),
      })
    );
    expect(JSON.stringify(harness.service.getStatus())).not.toContain(
      'registry-password-should-not-appear'
    );
    expect(harness.listActiveWwebjsRuntimeSafetyDrifts).not.toHaveBeenCalled();
    expect(harness.service.getStatus()).toEqual(
      expect.objectContaining({
        last_rollout_outcome: 'resolution_degraded',
        last_success_at: null,
        last_wwebjs_safety_migration_outcome: 'resolution_degraded',
      })
    );
  });

  it('reports observation failures without turning them into lifecycle work', async () => {
    const harness = buildHarness({
      listActiveWorkerImageDrifts: jest.fn(async () => {
        throw new Error('docker unavailable');
      }),
      listActiveWwebjsRuntimeSafetyDrifts: jest.fn(async () => {
        throw new Error('docker unavailable');
      }),
    });

    await harness.service.reconcileNow();

    expect(harness.service.getStatus()).toEqual(
      expect.objectContaining({
        active_drift_count: null,
        active_rollout_enabled: false,
        active_wwebjs_safety_drift_count: null,
        last_rollout_error_code: 'worker_image_drift_scan_failed',
        last_rollout_outcome: 'scan_failed',
        last_wwebjs_safety_migration_error_code:
          'worker_wwebjs_safety_migration_scan_failed',
        last_wwebjs_safety_migration_outcome: 'scan_failed',
        wwebjs_safety_migration_enabled: false,
      })
    );
  });

  it('starts idempotently and aborts an in-flight image provision on stop', async () => {
    const observedSignals: AbortSignal[] = [];
    const ensureImage = jest.fn(
      async (_alias: EWorkerImage, options: { abortSignal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          observedSignals.push(options.abortSignal);
          options.abortSignal.addEventListener(
            'abort',
            () => reject(new Error('worker_image_provision_aborted')),
            { once: true }
          );
        })
    );
    const harness = buildHarness({ ensureImage });

    harness.service.start();
    harness.service.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(ensureImage).toHaveBeenCalledTimes(1);

    await harness.service.stop();

    expect(observedSignals).toHaveLength(1);
    expect(observedSignals[0].aborted).toBe(true);
    expect(harness.service.getStatus()).toEqual(
      expect.objectContaining({ is_reconciling: false, is_running: false })
    );
  });
});
