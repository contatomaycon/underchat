import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import {
  parseWorkerSelfHealRecoveryState,
  workerSelfHealDailyKey,
  workerSelfHealRecoveryKey,
} from '@core/common/functions/workerSelfHealingKeys';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';
import {
  workerErrorDiagnostics,
  workerErrorFailureReason,
} from '@core/common/functions/workerErrorDiagnostics';

interface WorkerSelfMonitorReadiness {
  isHealthy?: boolean;
  reason?: string;
  session_ready?: boolean;
  can_send?: boolean;
  can_receive_runtime?: boolean;
  authenticated?: boolean;
  provider_state?: string;
  degraded_reason?: string;
  phone?: string;
  recoverable_session?: boolean;
}

interface WorkerDispatchAuthorizationObservation {
  pending: boolean;
  stalled: boolean;
}

interface WorkerSelfMonitorLogger {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

export interface WorkerSelfMonitorOptions {
  provider: EWorkerType;
  workerId: string;
  accountId: string;
  workerTypeId: EWorkerType;
  runtimeGeneration?: number;
  warmStandby?: boolean;
  getReadiness: () => Promise<WorkerSelfMonitorReadiness>;
  hasUnhealthyKafkaConsumer: () => boolean;
  isKafkaDispatchAuthorized?: () => boolean;
  dispatchAuthorizationGraceMs?: number;
  getKafkaConsumerHealthSnapshots?: () => unknown[];
  log?: WorkerSelfMonitorLogger;
  intervalMs?: number;
  initialDelayMs?: number;
  readinessTimeoutMs?: number;
  failureThreshold?: number;
  recoveryWindowSeconds?: number;
  dailyMaintenanceEnabled?: boolean;
  dailyMaintenanceHour?: number;
  dailyMaintenanceMinute?: number;
  timeZone?: string;
}

@singleton()
export class WorkerSelfMonitorService {
  private static readonly DEFAULT_DISPATCH_AUTHORIZATION_GRACE_MS = 60_000;

  private intervalId: NodeJS.Timeout | undefined;
  private initialTimer: NodeJS.Timeout | undefined;
  private options: WorkerSelfMonitorOptions | undefined;
  private consecutiveFailures = 0;
  private hasObservedActiveSession = false;
  private running = false;
  private checking = false;
  private readinessProbeInFlight:
    Promise<WorkerSelfMonitorReadiness> | undefined;
  private dispatchAuthorizationPendingSince: number | undefined;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService
  ) {}

  start(options: WorkerSelfMonitorOptions): void {
    if (this.running) {
      return;
    }

    if (options.warmStandby) {
      options.log?.info?.(
        {
          component: 'worker_self_monitor',
          worker_id: options.workerId,
          worker_type_id: options.workerTypeId,
        },
        'Worker self monitor skipped for warm standby'
      );
      return;
    }

    this.options = {
      ...options,
      intervalMs:
        options.intervalMs ??
        Math.max(
          5000,
          Number(process.env.WORKER_SELF_MONITOR_INTERVAL_MS) || 30_000
        ),
      initialDelayMs:
        options.initialDelayMs ??
        Math.max(
          0,
          Number(process.env.WORKER_SELF_MONITOR_INITIAL_DELAY_MS) || 15_000
        ),
      readinessTimeoutMs:
        options.readinessTimeoutMs ??
        Math.max(
          1000,
          Number(process.env.WORKER_SELF_MONITOR_READINESS_TIMEOUT_MS) || 15_000
        ),
      failureThreshold:
        options.failureThreshold ??
        Math.max(
          1,
          Number(process.env.WORKER_SELF_MONITOR_FAILURE_THRESHOLD) || 3
        ),
      recoveryWindowSeconds:
        options.recoveryWindowSeconds ??
        Math.max(
          60,
          Number(process.env.WORKER_SELF_HEAL_RECOVERY_WINDOW_SECONDS) ||
            10 * 60
        ),
      dailyMaintenanceEnabled:
        options.dailyMaintenanceEnabled ??
        this.booleanEnvironmentFlag(
          process.env.WORKER_DAILY_MAINTENANCE_ENABLED
        ),
      ...this.resolveDailyMaintenanceSchedule(
        options.dailyMaintenanceHour,
        options.dailyMaintenanceMinute
      ),
      timeZone:
        options.timeZone ??
        process.env.TZ ??
        process.env.APP_TIMEZONE ??
        'America/Sao_Paulo',
    };
    this.consecutiveFailures = 0;
    this.hasObservedActiveSession = false;
    this.dispatchAuthorizationPendingSince = undefined;
    this.running = true;

    const initialDelayMs = this.options.initialDelayMs ?? 0;
    this.initialTimer = setTimeout(() => {
      void this.runOnce().catch((err) => this.logError(err));
    }, initialDelayMs);
    this.initialTimer.unref?.();

    this.intervalId = setInterval(() => {
      void this.runOnce().catch((err) => this.logError(err));
    }, this.options.intervalMs);
    this.intervalId.unref?.();
  }

  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = undefined;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.running = false;
    this.checking = false;
    this.readinessProbeInFlight = undefined;
    this.consecutiveFailures = 0;
    this.hasObservedActiveSession = false;
    this.dispatchAuthorizationPendingSince = undefined;
  }

  async runOnce(): Promise<void> {
    const options = this.options;
    if (!options || !this.running || this.checking) {
      return;
    }

    this.checking = true;
    try {
      const providerReadiness = await this.getReadinessSafely(options);
      const kafkaUnhealthy = options.hasUnhealthyKafkaConsumer();
      this.updateActiveSessionEvidence(providerReadiness);
      const providerHealthy = this.isStrictlyHealthy(
        providerReadiness,
        kafkaUnhealthy
      );
      const dispatchAuthorization = this.observeDispatchAuthorization(
        options,
        providerHealthy
      );
      const readiness = dispatchAuthorization.pending
        ? this.maskDispatchAuthorizationReadiness(
            providerReadiness,
            dispatchAuthorization.stalled
          )
        : providerReadiness;
      const healthy = providerHealthy && dispatchAuthorization.pending !== true;

      if (!dispatchAuthorization.pending || dispatchAuthorization.stalled) {
        await this.handleRecoveryWindow(
          readiness,
          kafkaUnhealthy,
          healthy
        ).catch((error) => {
          this.logCoordinationFailure('recovery_window', error);
        });
        await this.maybeRequestDailyMaintenance(
          readiness,
          kafkaUnhealthy
        ).catch((error) => {
          this.logCoordinationFailure('daily_maintenance', error);
        });
      }

      if (healthy) {
        this.consecutiveFailures = 0;
        return;
      }

      const shouldEscalate =
        dispatchAuthorization.stalled ||
        (!dispatchAuthorization.pending &&
          this.shouldEscalate(readiness, kafkaUnhealthy));
      if (!shouldEscalate) {
        this.consecutiveFailures = 0;
        logLocalConnectionStatus('worker.self_monitor.pending', {
          layer: options.provider,
          provider: options.provider,
          worker_id: options.workerId,
          account_id: options.accountId,
          worker_type_id: options.workerTypeId,
          session_ready: readiness.session_ready,
          can_send: readiness.can_send,
          can_receive_runtime: readiness.can_receive_runtime,
          authenticated: readiness.authenticated,
          provider_state: readiness.provider_state,
          degraded_reason: readiness.degraded_reason ?? readiness.reason,
          kafka_unhealthy: kafkaUnhealthy,
          active_session_observed: this.hasObservedActiveSession,
          recoverable_session: readiness.recoverable_session === true,
        });
        return;
      }

      this.consecutiveFailures += 1;
      logLocalConnectionStatus('worker.self_monitor.unhealthy', {
        layer: options.provider,
        provider: options.provider,
        worker_id: options.workerId,
        account_id: options.accountId,
        worker_type_id: options.workerTypeId,
        session_ready: readiness.session_ready,
        can_send: readiness.can_send,
        can_receive_runtime: readiness.can_receive_runtime,
        authenticated: readiness.authenticated,
        provider_state: readiness.provider_state,
        degraded_reason: readiness.degraded_reason ?? readiness.reason,
        kafka_unhealthy: kafkaUnhealthy,
        active_session_observed: this.hasObservedActiveSession,
        recoverable_session: readiness.recoverable_session === true,
        failure_count: this.consecutiveFailures,
        failure_threshold: options.failureThreshold,
      });

      if (
        this.consecutiveFailures >= (options.failureThreshold ?? 3) &&
        shouldEscalate
      ) {
        await this.requestSelfHealing(
          'health_monitor',
          readiness,
          kafkaUnhealthy
        );
        this.consecutiveFailures = 0;
      }
    } finally {
      this.checking = false;
    }
  }

  private isStrictlyHealthy(
    readiness: WorkerSelfMonitorReadiness,
    kafkaUnhealthy: boolean
  ): boolean {
    return (
      readiness.session_ready === true &&
      readiness.can_send === true &&
      readiness.can_receive_runtime === true &&
      readiness.authenticated === true &&
      Boolean(readiness.phone?.trim()) &&
      kafkaUnhealthy !== true
    );
  }

  private observeDispatchAuthorization(
    options: WorkerSelfMonitorOptions,
    providerHealthy: boolean
  ): WorkerDispatchAuthorizationObservation {
    if (!options.isKafkaDispatchAuthorized || !providerHealthy) {
      this.dispatchAuthorizationPendingSince = undefined;
      return { pending: false, stalled: false };
    }

    let authorized = false;
    try {
      authorized = options.isKafkaDispatchAuthorized() === true;
    } catch {
      authorized = false;
    }
    if (authorized) {
      this.dispatchAuthorizationPendingSince = undefined;
      return { pending: false, stalled: false };
    }

    const now = Date.now();
    this.dispatchAuthorizationPendingSince ??= now;
    const graceMs = Math.max(
      0,
      options.dispatchAuthorizationGraceMs ??
        WorkerSelfMonitorService.DEFAULT_DISPATCH_AUTHORIZATION_GRACE_MS
    );
    return {
      pending: true,
      stalled: now - this.dispatchAuthorizationPendingSince >= graceMs,
    };
  }

  private maskDispatchAuthorizationReadiness(
    readiness: WorkerSelfMonitorReadiness,
    stalled: boolean
  ): WorkerSelfMonitorReadiness {
    return {
      ...readiness,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      degraded_reason: stalled
        ? 'dispatch_authorization_stalled'
        : 'awaiting_dispatch_authorization',
    };
  }

  private shouldEscalate(
    readiness: WorkerSelfMonitorReadiness,
    kafkaUnhealthy: boolean
  ): boolean {
    const hasCurrentSessionEvidence = this.hasActiveSessionEvidence(readiness);
    const hasRetainedSessionEvidence =
      (this.hasObservedActiveSession ||
        readiness.recoverable_session === true) &&
      this.isInconclusiveSessionProbeFailure(readiness);

    if (!hasCurrentSessionEvidence && !hasRetainedSessionEvidence) {
      return false;
    }

    /*
     * Kafka degradation is only a self-heal signal for a runtime that is
     * serving, was observed serving, or explicitly reports a recoverable
     * persisted session. This prevents fresh/disconnected workers from
     * recreating in a loop while allowing a missing provider runtime to be
     * recovered after its local reconnect path has failed.
     */
    return kafkaUnhealthy || !this.isStrictlyHealthy(readiness, false);
  }

  private hasActiveSessionEvidence(
    readiness: WorkerSelfMonitorReadiness
  ): boolean {
    if (
      readiness.authenticated !== true ||
      this.isPassiveSessionState(readiness)
    ) {
      return false;
    }

    const providerState = (readiness.provider_state ?? '').toLowerCase();
    return (
      readiness.session_ready === true ||
      Boolean(readiness.phone?.trim()) ||
      providerState.includes('connected') ||
      providerState === 'open' ||
      providerState === 'ready'
    );
  }

  private updateActiveSessionEvidence(
    readiness: WorkerSelfMonitorReadiness
  ): void {
    if (this.hasActiveSessionEvidence(readiness)) {
      this.hasObservedActiveSession = true;
      return;
    }

    /*
     * A failed provider probe is inconclusive: the health result can no longer
     * prove `authenticated`, even though this runtime was serving an
     * authenticated session or still owns a recoverable persisted session.
     * Retain that evidence so repeated failures trigger self-healing.
     */
    if (this.isInconclusiveSessionProbeFailure(readiness)) {
      return;
    }

    if (this.isDefinitiveInactiveSessionState(readiness)) {
      this.hasObservedActiveSession = false;
    }
  }

  private isInconclusiveSessionProbeFailure(
    readiness: WorkerSelfMonitorReadiness
  ): boolean {
    const providerState = (readiness.provider_state ?? '').trim().toLowerCase();
    const reason = `${readiness.degraded_reason ?? ''} ${
      readiness.reason ?? ''
    }`.toLowerCase();
    const recoverableProviderRuntimeMissing =
      readiness.recoverable_session === true &&
      (providerState === 'missing_socket' ||
        providerState === 'missing_client' ||
        providerState === 'closing' ||
        providerState === 'closed' ||
        reason.includes('no socket instance') ||
        reason.includes('runtime instance missing') ||
        reason.includes('websocket client state: closing') ||
        reason.includes('websocket client state: closed') ||
        reason.includes('websocket state: closing') ||
        reason.includes('websocket state: closed'));

    if (recoverableProviderRuntimeMissing) {
      return true;
    }

    if (this.isDefinitiveInactiveSessionState(readiness)) {
      return false;
    }

    return (
      providerState === 'state_error' ||
      providerState === 'state_unavailable' ||
      providerState === 'state_probe_pending' ||
      reason.includes('failed to get state') ||
      reason.includes('state probe failed') ||
      reason.includes('readiness probe failed') ||
      reason.includes('protocol error') ||
      reason.includes('timed out') ||
      reason.includes('timeout')
    );
  }

  private isDefinitiveInactiveSessionState(
    readiness: WorkerSelfMonitorReadiness
  ): boolean {
    const state = `${readiness.provider_state ?? ''} ${
      readiness.degraded_reason ?? readiness.reason ?? ''
    }`.toLowerCase();

    return [
      'qr',
      'pairing',
      'no_session',
      'not_authenticated',
      'logged_out',
      'bad_session',
      'mismatch',
      'launching',
      'not_initialized',
      'runtime_not_initialized',
      'not initialized',
      'disconnected',
      'disconnecting',
      'offline',
      'closed',
      'awaiting_connection',
      'awaiting connection',
    ].some((marker) => state.includes(marker));
  }

  private isPassiveSessionState(
    readiness: WorkerSelfMonitorReadiness
  ): boolean {
    return this.isDefinitiveInactiveSessionState(readiness);
  }

  private async getReadinessSafely(
    options: WorkerSelfMonitorOptions
  ): Promise<WorkerSelfMonitorReadiness> {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      let readinessProbe = this.readinessProbeInFlight;
      if (!readinessProbe) {
        readinessProbe = Promise.resolve().then(() => options.getReadiness());
        this.readinessProbeInFlight = readinessProbe;
        void readinessProbe.then(
          () => {
            if (this.readinessProbeInFlight === readinessProbe) {
              this.readinessProbeInFlight = undefined;
            }
          },
          () => {
            if (this.readinessProbeInFlight === readinessProbe) {
              this.readinessProbeInFlight = undefined;
            }
          }
        );
      }

      const timeoutMs = this.normalizePositiveInteger(
        options.readinessTimeoutMs
      );
      if (!timeoutMs) {
        return await readinessProbe;
      }

      return await Promise.race([
        readinessProbe,
        new Promise<never>((_resolve, reject) => {
          deadlineTimer = setTimeout(() => {
            reject(
              new Error(`Worker readiness probe timeout after ${timeoutMs}ms`)
            );
          }, timeoutMs);
          deadlineTimer.unref?.();
        }),
      ]);
    } catch (error) {
      options.log?.warn?.(
        {
          component: 'worker_self_monitor',
          worker_id: options.workerId,
          worker_type_id: options.workerTypeId,
          ...workerErrorDiagnostics(error),
        },
        'Worker readiness probe failed'
      );
      return {
        isHealthy: false,
        reason: workerErrorFailureReason('readiness_probe_failed', error),
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'state_error',
        degraded_reason: 'readiness_probe_failed',
      };
    } finally {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
    }
  }

  private async handleRecoveryWindow(
    readiness: WorkerSelfMonitorReadiness,
    kafkaUnhealthy: boolean,
    healthy: boolean
  ): Promise<void> {
    const options = this.options;
    if (!options) {
      return;
    }

    const key = workerSelfHealRecoveryKey(options.workerId);
    const recovery = parseWorkerSelfHealRecoveryState(
      await this.redis.get(key)
    );
    if (!recovery) {
      return;
    }

    const recoveryGeneration = Number(recovery.runtime_generation);
    const activeGeneration = Number(options.runtimeGeneration);
    if (
      !Number.isSafeInteger(recoveryGeneration) ||
      recoveryGeneration <= 0 ||
      !Number.isSafeInteger(activeGeneration) ||
      activeGeneration <= 0 ||
      recoveryGeneration !== activeGeneration
    ) {
      return;
    }

    if (healthy) {
      this.consecutiveFailures = 0;
      logLocalConnectionStatus('worker.self_monitor.recovery_healthy', {
        layer: options.provider,
        provider: options.provider,
        worker_id: options.workerId,
        account_id: options.accountId,
        worker_type_id: options.workerTypeId,
        source: recovery.source,
        reason: recovery.reason,
        recovery_operation_id: recovery.operation_id,
        runtime_generation: activeGeneration,
        recovery_retained: true,
      });
      return;
    }

    if (Date.now() <= new Date(recovery.deadline_at).getTime()) {
      return;
    }

    await this.notifyRecoveryTimeout(readiness, kafkaUnhealthy);
  }

  private async notifyRecoveryTimeout(
    readiness: WorkerSelfMonitorReadiness,
    kafkaUnhealthy: boolean
  ): Promise<void> {
    const options = this.options;
    if (!options) {
      return;
    }

    const state: IBaileysConnectionState = {
      code: ECodeMessage.connectionLost,
      status: EBaileysConnectionStatus.disconnected,
      worker_id: options.workerId,
      account_id: options.accountId,
      worker_type_id: options.workerTypeId,
      worker_status_id: EWorkerStatus.offline,
      reason: 'self_heal_recovery_timeout',
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: readiness.provider_state ?? 'recovery_timeout',
      degraded_reason: 'self_heal_recovery_timeout',
      debug_trace_id: this.buildTraceId('recovery_timeout'),
      runtime_generation: options.runtimeGeneration,
    };

    logLocalConnectionStatus('worker.self_monitor.recovery_timeout', {
      layer: options.provider,
      provider: options.provider,
      worker_id: options.workerId,
      account_id: options.accountId,
      worker_type_id: options.workerTypeId,
      kafka_unhealthy: kafkaUnhealthy,
      provider_state: readiness.provider_state,
      degraded_reason: readiness.degraded_reason ?? readiness.reason,
    });
    await this.balanceWorkerStatusGrpcClientService.notifyWorkerStatus(state);
  }

  private async maybeRequestDailyMaintenance(
    readiness: WorkerSelfMonitorReadiness,
    kafkaUnhealthy: boolean
  ): Promise<void> {
    const options = this.options;
    if (!options) {
      return;
    }

    if (
      options.dailyMaintenanceEnabled !== true ||
      !this.hasActiveSessionEvidence(readiness)
    ) {
      return;
    }

    const parts = this.localDateTime(options.timeZone ?? 'America/Sao_Paulo');
    const scheduledHour = options.dailyMaintenanceHour ?? 2;
    const scheduledMinute = options.dailyMaintenanceMinute ?? 0;
    if (parts.hour !== scheduledHour || parts.minute < scheduledMinute) {
      return;
    }

    const schedule = this.dailyMaintenanceScheduleKey(
      scheduledHour,
      scheduledMinute
    );
    const dailyKey = workerSelfHealDailyKey(
      options.workerId,
      parts.date,
      schedule
    );
    const acquired = await this.redis.set(
      dailyKey,
      '1',
      'EX',
      36 * 60 * 60,
      'NX'
    );
    if (acquired !== 'OK') {
      logLocalConnectionStatus('worker.self_monitor.daily_skipped_dedupe', {
        layer: options.provider,
        provider: options.provider,
        worker_id: options.workerId,
        account_id: options.accountId,
        worker_type_id: options.workerTypeId,
        local_date: parts.date,
        schedule,
        daily_key: dailyKey,
      });
      return;
    }

    try {
      await this.requestSelfHealing(
        'daily_maintenance',
        readiness,
        kafkaUnhealthy
      );
    } catch (error) {
      /*
       * The NX key is only a delivery claim. If Balance is unavailable, release
       * it so a later monitor pass can redrive the same daily maintenance.
       */
      await this.redis.del(dailyKey).catch(() => undefined);
      throw error;
    }
  }

  private async requestSelfHealing(
    source: string,
    readiness: WorkerSelfMonitorReadiness,
    kafkaUnhealthy: boolean
  ): Promise<void> {
    const options = this.options;
    if (!options) {
      return;
    }

    await this.balanceWorkerStatusGrpcClientService.requestWorkerSelfHealing({
      worker_id: options.workerId,
      account_id: options.accountId,
      worker_type_id: options.workerTypeId,
      source,
      reason:
        readiness.degraded_reason ??
        readiness.reason ??
        (kafkaUnhealthy ? 'kafka_unhealthy' : 'runtime_unhealthy'),
      provider_state: readiness.provider_state ?? '',
      degraded_reason: readiness.degraded_reason ?? readiness.reason ?? '',
      kafka_unhealthy: kafkaUnhealthy,
      session_ready: readiness.session_ready === true,
      can_send: readiness.can_send === true,
      can_receive_runtime: readiness.can_receive_runtime === true,
      authenticated: readiness.authenticated === true,
      phone: readiness.phone?.trim() ?? '',
      runtime_generation: options.runtimeGeneration,
      debug_trace_id: this.buildTraceId(source),
      recovery_window_seconds: options.recoveryWindowSeconds,
    });
  }

  private localDateTime(timeZone: string): {
    date: string;
    hour: number;
    minute: number;
  } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const hour = Number.parseInt(get('hour'), 10);
    const minute = Number.parseInt(get('minute'), 10);
    return {
      date,
      hour: Number.isFinite(hour) ? hour : -1,
      minute: Number.isFinite(minute) ? minute : -1,
    };
  }

  private buildTraceId(source: string): string {
    const options = this.options;
    return `self-heal:${source}:${options?.workerId ?? 'unknown'}:${Date.now()}`;
  }

  private resolveDailyMaintenanceSchedule(
    optionHour?: number,
    optionMinute?: number
  ): { dailyMaintenanceHour: number; dailyMaintenanceMinute: number } {
    if (optionHour !== undefined) {
      return {
        dailyMaintenanceHour: optionHour,
        dailyMaintenanceMinute: optionMinute ?? 0,
      };
    }

    const raw = (
      process.env.WORKER_DAILY_MAINTENANCE_TIME ??
      process.env.WORKER_DAILY_MAINTENANCE_HOUR
    )?.trim();
    if (!raw) {
      return { dailyMaintenanceHour: 2, dailyMaintenanceMinute: 0 };
    }

    const parts = raw.split(':');
    if (parts.length > 2) {
      return { dailyMaintenanceHour: 2, dailyMaintenanceMinute: 0 };
    }

    const hour = Number.parseInt(parts[0] ?? '', 10);
    const minute = parts.length === 2 ? Number.parseInt(parts[1] ?? '', 10) : 0;
    if (
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isInteger(minute) ||
      minute < 0 ||
      minute > 59
    ) {
      return { dailyMaintenanceHour: 2, dailyMaintenanceMinute: 0 };
    }

    return {
      dailyMaintenanceHour: hour,
      dailyMaintenanceMinute: minute,
    };
  }

  private dailyMaintenanceScheduleKey(hour: number, minute: number): string {
    return `${hour.toString().padStart(2, '0')}${minute
      .toString()
      .padStart(2, '0')}`;
  }

  private booleanEnvironmentFlag(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(
      value?.trim().toLowerCase() ?? ''
    );
  }

  private normalizePositiveInteger(
    value: number | undefined
  ): number | undefined {
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return Math.floor(value);
  }

  private logError(error: unknown): void {
    const options = this.options;
    options?.log?.error?.(
      {
        worker_id: options.workerId,
        ...workerErrorDiagnostics(error),
      },
      'Worker self monitor check failed'
    );
  }

  private logCoordinationFailure(source: string, error: unknown): void {
    const options = this.options;
    options?.log?.warn?.(
      {
        component: 'worker_self_monitor',
        worker_id: options.workerId,
        worker_type_id: options.workerTypeId,
        source,
        ...workerErrorDiagnostics(error),
      },
      'Worker self monitor coordination failed; local health evaluation continues'
    );
    logLocalConnectionStatus('worker.self_monitor.coordination_failed', {
      layer: options?.provider ?? 'worker',
      provider: options?.provider,
      worker_id: options?.workerId,
      account_id: options?.accountId,
      worker_type_id: options?.workerTypeId,
      source,
      reason: workerErrorFailureReason(
        'worker_self_monitor_coordination_failed',
        error
      ),
    });
  }
}
