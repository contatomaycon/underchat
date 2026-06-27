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
  getKafkaConsumerHealthSnapshots?: () => unknown[];
  log?: WorkerSelfMonitorLogger;
  intervalMs?: number;
  initialDelayMs?: number;
  failureThreshold?: number;
  recoveryWindowSeconds?: number;
  dailyMaintenanceHour?: number;
  dailyMaintenanceMinute?: number;
  timeZone?: string;
}

@singleton()
export class WorkerSelfMonitorService {
  private intervalId: NodeJS.Timeout | undefined;
  private initialTimer: NodeJS.Timeout | undefined;
  private options: WorkerSelfMonitorOptions | undefined;
  private consecutiveFailures = 0;
  private running = false;
  private checking = false;

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
  }

  async runOnce(): Promise<void> {
    const options = this.options;
    if (!options || this.checking) {
      return;
    }

    this.checking = true;
    try {
      const readiness = await options.getReadiness();
      const kafkaUnhealthy = options.hasUnhealthyKafkaConsumer();
      const healthy = this.isStrictlyHealthy(readiness, kafkaUnhealthy);

      await this.handleRecoveryWindow(readiness, kafkaUnhealthy, healthy);
      await this.maybeRequestDailyMaintenance(readiness, kafkaUnhealthy);

      if (healthy) {
        this.consecutiveFailures = 0;
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
        failure_count: this.consecutiveFailures,
        failure_threshold: options.failureThreshold,
      });

      if (
        this.consecutiveFailures >= (options.failureThreshold ?? 3) &&
        this.shouldEscalate(readiness, kafkaUnhealthy)
      ) {
        await this.requestSelfHealing(
          'health_monitor',
          readiness,
          kafkaUnhealthy
        );
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
      kafkaUnhealthy !== true
    );
  }

  private shouldEscalate(
    readiness: WorkerSelfMonitorReadiness,
    kafkaUnhealthy: boolean
  ): boolean {
    if (kafkaUnhealthy) {
      return true;
    }

    const state = `${readiness.provider_state ?? ''} ${
      readiness.degraded_reason ?? readiness.reason ?? ''
    }`.toLowerCase();
    const waitingForUserSession =
      state.includes('qr') ||
      state.includes('pairing') ||
      state.includes('no_session') ||
      state.includes('not_authenticated') ||
      state.includes('logged_out') ||
      state.includes('bad_session') ||
      state.includes('mismatch');

    if (
      waitingForUserSession &&
      readiness.session_ready !== true &&
      readiness.can_send !== true &&
      readiness.can_receive_runtime !== true &&
      readiness.authenticated !== true
    ) {
      return false;
    }

    return true;
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

    if (healthy) {
      await this.redis.del(key);
      this.consecutiveFailures = 0;
      logLocalConnectionStatus('worker.self_monitor.recovery_healthy', {
        layer: options.provider,
        provider: options.provider,
        worker_id: options.workerId,
        account_id: options.accountId,
        worker_type_id: options.workerTypeId,
        source: recovery.source,
        reason: recovery.reason,
      });
      return;
    }

    if (Date.now() <= new Date(recovery.deadline_at).getTime()) {
      return;
    }

    await this.notifyRecoveryTimeout(readiness, kafkaUnhealthy);
    await this.redis.del(key);
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

    const parts = this.localDateTime(options.timeZone ?? 'America/Sao_Paulo');
    const scheduledHour = options.dailyMaintenanceHour ?? 2;
    const scheduledMinute = options.dailyMaintenanceMinute ?? 0;
    if (parts.hour !== scheduledHour || parts.minute < scheduledMinute) {
      return;
    }

    const dailyKey = workerSelfHealDailyKey(options.workerId, parts.date);
    const acquired = await this.redis.set(
      dailyKey,
      '1',
      'EX',
      36 * 60 * 60,
      'NX'
    );
    if (acquired !== 'OK') {
      return;
    }

    await this.requestSelfHealing(
      'daily_maintenance',
      readiness,
      kafkaUnhealthy
    );
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

  private logError(error: unknown): void {
    const options = this.options;
    options?.log?.error?.(
      { err: error, worker_id: options.workerId },
      'Worker self monitor check failed'
    );
  }
}
