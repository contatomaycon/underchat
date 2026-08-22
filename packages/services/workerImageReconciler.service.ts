import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { buildEnvironment } from '@core/config/environments';
import {
  type ActiveWorkerImageDrift,
  type ActiveWwebjsRuntimeSafetyDrift,
  WorkerService,
} from '@core/services/worker.service';
import { WorkerImageProvisionerService } from '@core/services/workerImageProvisioner.service';
import { inject, singleton } from 'tsyringe';

interface WorkerImageReconcileAliasStatus {
  readonly content_id: string | null;
  readonly error_code: string | null;
  readonly content_stable_since: string | null;
  readonly last_attempt_at: string | null;
  readonly last_success_at: string | null;
}

export interface WorkerImageReconcilerStatus {
  readonly aliases: Record<string, WorkerImageReconcileAliasStatus>;
  readonly active_drift_count: number | null;
  readonly active_rollout_enabled: boolean;
  readonly active_wwebjs_safety_drift_count: number | null;
  readonly interval_ms: number;
  readonly is_reconciling: boolean;
  readonly is_running: boolean;
  readonly last_attempt_at: string | null;
  readonly last_rollout_at: string | null;
  readonly last_rollout_attempt_at: string | null;
  readonly last_rollout_error_at: string | null;
  readonly last_rollout_error_code: string | null;
  readonly last_rollout_outcome:
    | 'candidate_stale'
    | 'disabled'
    | 'enqueue_failed'
    | 'enqueued'
    | 'manual_only'
    | 'no_drift'
    | 'resolution_degraded'
    | 'safety_preempted'
    | 'scan_failed'
    | 'throttle_unavailable'
    | 'throttled'
    | 'waiting_for_stability'
    | null;
  readonly last_rollout_worker_id: string | null;
  readonly last_wwebjs_safety_migration_at: string | null;
  readonly last_wwebjs_safety_migration_attempt_at: string | null;
  readonly last_wwebjs_safety_migration_error_at: string | null;
  readonly last_wwebjs_safety_migration_error_code: string | null;
  readonly last_wwebjs_safety_migration_outcome:
    | 'candidate_stale'
    | 'disabled'
    | 'enqueue_failed'
    | 'enqueued'
    | 'manual_only'
    | 'no_drift'
    | 'resolution_degraded'
    | 'scan_failed'
    | 'throttle_unavailable'
    | 'throttled'
    | null;
  readonly last_wwebjs_safety_migration_reasons:
    ActiveWwebjsRuntimeSafetyDrift['safety_reasons'] | null;
  readonly last_wwebjs_safety_migration_worker_id: string | null;
  readonly last_success_at: string | null;
  readonly wwebjs_safety_migration_enabled: boolean;
}

const RECONCILED_ALIASES = [
  EWorkerImage.baileys,
  EWorkerImage.wwebjs,
  EWorkerImage.whatsmeow,
] as const;
const RECONCILER_STOP_TIMEOUT_MS = 5_000;

function safeProvisionErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    /^worker_image_[a-z0-9_]+$/u.test(error.message)
  ) {
    return error.message;
  }

  return 'worker_image_reconcile_failed';
}

@singleton()
export class WorkerImageReconcilerService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private reconcilePromise: Promise<void> | null = null;
  private reconcileAbortController: AbortController | null = null;
  private lastAttemptAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private activeDriftCount: number | null = null;
  private activeWwebjsSafetyDriftCount: number | null = null;
  private lastRolloutAt: string | null = null;
  private lastRolloutAttemptAt: string | null = null;
  private lastRolloutErrorAt: string | null = null;
  private lastRolloutErrorCode: string | null = null;
  private lastRolloutOutcome: WorkerImageReconcilerStatus['last_rollout_outcome'] =
    null;
  private lastRolloutWorkerId: string | null = null;
  private lastWwebjsSafetyMigrationAt: string | null = null;
  private lastWwebjsSafetyMigrationAttemptAt: string | null = null;
  private lastWwebjsSafetyMigrationErrorAt: string | null = null;
  private lastWwebjsSafetyMigrationErrorCode: string | null = null;
  private lastWwebjsSafetyMigrationOutcome: WorkerImageReconcilerStatus['last_wwebjs_safety_migration_outcome'] =
    null;
  private lastWwebjsSafetyMigrationReasons:
    ActiveWwebjsRuntimeSafetyDrift['safety_reasons'] | null = null;
  private lastWwebjsSafetyMigrationWorkerId: string | null = null;
  private readonly aliasStatus = new Map<
    EWorkerImage,
    WorkerImageReconcileAliasStatus
  >(
    RECONCILED_ALIASES.map((alias) => [
      alias,
      {
        content_id: null,
        content_stable_since: null,
        error_code: null,
        last_attempt_at: null,
        last_success_at: null,
      },
    ])
  );

  constructor(
    @inject(WorkerImageProvisionerService)
    private readonly workerImageProvisionerService: WorkerImageProvisionerService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  public start(): void {
    if (this.interval) {
      return;
    }

    void this.reconcileNow();
    this.interval = setInterval(() => {
      void this.reconcileNow();
    }, buildEnvironment.workerImageReconcileIntervalMs);
    this.interval.unref?.();
  }

  public async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.reconcileAbortController?.abort();

    const activeReconciliation = this.reconcilePromise;
    if (!activeReconciliation) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const boundedWait = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, RECONCILER_STOP_TIMEOUT_MS);
      timer.unref?.();
    });
    try {
      await Promise.race([
        activeReconciliation.catch(() => undefined),
        boundedWait,
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  public async reconcileNow(): Promise<void> {
    if (this.reconcilePromise) {
      return this.reconcilePromise;
    }

    const abortController = new AbortController();
    this.reconcileAbortController = abortController;
    const operation = this.runReconciliation(abortController.signal);
    this.reconcilePromise = operation;
    const clearOperation = (): void => {
      if (this.reconcilePromise === operation) {
        this.reconcilePromise = null;
      }
      if (this.reconcileAbortController === abortController) {
        this.reconcileAbortController = null;
      }
    };
    void operation.then(clearOperation, clearOperation);

    return operation;
  }

  public getStatus(): WorkerImageReconcilerStatus {
    return {
      aliases: Object.fromEntries(this.aliasStatus.entries()),
      active_drift_count: this.activeDriftCount,
      // Image publication is observation/provisioning only. Active runtimes
      // are upgraded exclusively by an explicit manual recreate request.
      active_rollout_enabled: false,
      active_wwebjs_safety_drift_count: this.activeWwebjsSafetyDriftCount,
      interval_ms: buildEnvironment.workerImageReconcileIntervalMs,
      is_reconciling: this.reconcilePromise !== null,
      is_running: this.interval !== null,
      last_attempt_at: this.lastAttemptAt,
      last_rollout_at: this.lastRolloutAt,
      last_rollout_attempt_at: this.lastRolloutAttemptAt,
      last_rollout_error_at: this.lastRolloutErrorAt,
      last_rollout_error_code: this.lastRolloutErrorCode,
      last_rollout_outcome: this.lastRolloutOutcome,
      last_rollout_worker_id: this.lastRolloutWorkerId,
      last_wwebjs_safety_migration_at: this.lastWwebjsSafetyMigrationAt,
      last_wwebjs_safety_migration_attempt_at:
        this.lastWwebjsSafetyMigrationAttemptAt,
      last_wwebjs_safety_migration_error_at:
        this.lastWwebjsSafetyMigrationErrorAt,
      last_wwebjs_safety_migration_error_code:
        this.lastWwebjsSafetyMigrationErrorCode,
      last_wwebjs_safety_migration_outcome:
        this.lastWwebjsSafetyMigrationOutcome,
      last_wwebjs_safety_migration_reasons:
        this.lastWwebjsSafetyMigrationReasons,
      last_wwebjs_safety_migration_worker_id:
        this.lastWwebjsSafetyMigrationWorkerId,
      last_success_at: this.lastSuccessAt,
      wwebjs_safety_migration_enabled: false,
    };
  }

  private async runReconciliation(abortSignal: AbortSignal): Promise<void> {
    const attemptedAt = new Date().toISOString();
    this.lastAttemptAt = attemptedAt;
    let hasFailure = false;
    const expectedContentIds: Record<string, string> = {};
    /*
     * Worker images are large and share one host link/Docker daemon. Pulling
     * all three simultaneously can exhaust bandwidth and make every deadline
     * fail. Reconcile one alias at a time; on-demand creation still provisions
     * its own required alias through the provisioner's per-alias singleflight.
     */
    for (const alias of RECONCILED_ALIASES) {
      if (abortSignal.aborted) {
        return;
      }
      try {
        const result = await this.workerImageProvisionerService.ensureImage(
          alias,
          { abortSignal }
        );
        const succeededAt = new Date().toISOString();
        const previous = this.aliasStatus.get(alias);
        const contentStableSince =
          previous?.content_id === result.contentId
            ? (previous.content_stable_since ?? succeededAt)
            : succeededAt;
        expectedContentIds[alias] = result.contentId;
        this.aliasStatus.set(alias, {
          content_id: result.contentId,
          content_stable_since: contentStableSince,
          error_code: null,
          last_attempt_at: attemptedAt,
          last_success_at: succeededAt,
        });
        continue;
      } catch (error) {
        hasFailure = true;
        const previous = this.aliasStatus.get(alias);
        this.aliasStatus.set(alias, {
          content_id: previous?.content_id ?? null,
          content_stable_since: previous?.content_stable_since ?? null,
          error_code: safeProvisionErrorCode(error),
          last_attempt_at: attemptedAt,
          last_success_at: previous?.last_success_at ?? null,
        });
      }
    }

    if (!hasFailure) {
      this.lastSuccessAt = new Date().toISOString();
    }

    if (abortSignal.aborted) {
      return;
    }
    await this.reconcileWwebjsRuntimeSafety(
      expectedContentIds[EWorkerImage.wwebjs],
      abortSignal
    );
    if (abortSignal.aborted) {
      return;
    }
    await this.reconcileActiveWorkerDrift(
      expectedContentIds,
      abortSignal,
      !hasFailure
    );
  }

  /**
   * Observes WWebJS safety drift without mutating any active runtime. An image
   * publication may update the locally provisioned immutable content, but
   * applying it to a channel always requires the explicit manual recreate
   * flow. Missing/stopped/unhealthy runtime recovery is owned by the liveness
   * monitor and is intentionally independent from this observer.
   */
  private async reconcileWwebjsRuntimeSafety(
    expectedContentId: string | undefined,
    abortSignal: AbortSignal
  ): Promise<void> {
    this.lastWwebjsSafetyMigrationAttemptAt = new Date().toISOString();
    if (!expectedContentId) {
      this.activeWwebjsSafetyDriftCount = null;
      this.markWwebjsSafetyMigrationHealthy('resolution_degraded');
      return;
    }

    let drifts: ActiveWwebjsRuntimeSafetyDrift[];
    try {
      drifts =
        await this.workerService.listActiveWwebjsRuntimeSafetyDrifts(
          expectedContentId
        );
    } catch {
      this.activeWwebjsSafetyDriftCount = null;
      this.markWwebjsSafetyMigrationFailure(
        'worker_wwebjs_safety_migration_scan_failed',
        'scan_failed'
      );
      return;
    }
    this.activeWwebjsSafetyDriftCount = drifts.length;
    if (abortSignal.aborted) {
      return;
    }
    if (drifts.length === 0) {
      this.lastWwebjsSafetyMigrationReasons = null;
      this.lastWwebjsSafetyMigrationWorkerId = null;
      this.markWwebjsSafetyMigrationHealthy('no_drift');
      return;
    }

    const firstDrift = drifts[0];
    this.lastWwebjsSafetyMigrationWorkerId = firstDrift.worker_id;
    this.lastWwebjsSafetyMigrationReasons = firstDrift.safety_reasons;
    this.markWwebjsSafetyMigrationHealthy('manual_only');
  }

  /**
   * Counts immutable-image drift for diagnostics only. This observer has no
   * dependency on the lifecycle queue/monitor and therefore cannot recreate
   * an active channel even if legacy rollout ENVs remain set in a deployment.
   */
  private async reconcileActiveWorkerDrift(
    expectedContentIds: Readonly<Record<string, string>>,
    abortSignal: AbortSignal,
    rolloutAllowed: boolean
  ): Promise<void> {
    this.lastRolloutAttemptAt = new Date().toISOString();
    if (Object.keys(expectedContentIds).length === 0) {
      this.activeDriftCount = null;
      this.markRolloutHealthy('resolution_degraded');
      return;
    }

    let drifts: ActiveWorkerImageDrift[];
    try {
      drifts =
        await this.workerService.listActiveWorkerImageDrifts(
          expectedContentIds
        );
    } catch {
      this.activeDriftCount = null;
      this.markRolloutFailure('worker_image_drift_scan_failed', 'scan_failed');
      return;
    }
    this.activeDriftCount = drifts.length;
    if (abortSignal.aborted) {
      return;
    }
    if (!rolloutAllowed) {
      this.markRolloutHealthy('resolution_degraded');
      return;
    }
    if (drifts.length === 0) {
      this.markRolloutHealthy('no_drift');
      return;
    }
    this.markRolloutHealthy('manual_only');
  }

  private markRolloutHealthy(
    outcome: Exclude<
      WorkerImageReconcilerStatus['last_rollout_outcome'],
      | 'candidate_stale'
      | 'enqueue_failed'
      | 'scan_failed'
      | 'throttle_unavailable'
    >
  ): void {
    this.lastRolloutErrorCode = null;
    this.lastRolloutOutcome = outcome;
  }

  private markRolloutFailure(
    code: string,
    outcome:
      | 'candidate_stale'
      | 'enqueue_failed'
      | 'scan_failed'
      | 'throttle_unavailable'
  ): void {
    this.lastRolloutErrorAt = new Date().toISOString();
    this.lastRolloutErrorCode = code;
    this.lastRolloutOutcome = outcome;
  }

  private markWwebjsSafetyMigrationHealthy(
    outcome: Exclude<
      WorkerImageReconcilerStatus['last_wwebjs_safety_migration_outcome'],
      | 'candidate_stale'
      | 'enqueue_failed'
      | 'scan_failed'
      | 'throttle_unavailable'
    >
  ): void {
    this.lastWwebjsSafetyMigrationErrorCode = null;
    this.lastWwebjsSafetyMigrationOutcome = outcome;
  }

  private markWwebjsSafetyMigrationFailure(
    code: string,
    outcome:
      | 'candidate_stale'
      | 'enqueue_failed'
      | 'scan_failed'
      | 'throttle_unavailable'
  ): void {
    this.lastWwebjsSafetyMigrationErrorAt = new Date().toISOString();
    this.lastWwebjsSafetyMigrationErrorCode = code;
    this.lastWwebjsSafetyMigrationOutcome = outcome;
  }
}
