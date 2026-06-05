import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

export interface WorkerConnectionQrCodeConsumerReadiness {
  worker_id: string;
  account_id: string;
  worker_type_id: string;
  topic: string;
  group_id: string;
  ready_at: string;
  last_seen_at: string;
}

export interface WorkerConnectionQrCodeConsumerReadinessInput {
  worker_id: string;
  account_id: string;
  worker_type_id: string;
  topic: string;
  group_id: string;
}

@injectable()
export class WorkerConnectionQrCodeReadinessService {
  static readonly TTL_SECONDS = 30;
  private static readonly HEARTBEAT_INTERVAL_MS = 10_000;

  constructor(@inject('Redis') private readonly redis: Redis) {}

  key(workerId: string): string {
    return `worker:${workerId}:connection:qrcode:consumer:ready`;
  }

  async markReady(
    input: WorkerConnectionQrCodeConsumerReadinessInput
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.read(input.worker_id);
    const value: WorkerConnectionQrCodeConsumerReadiness = {
      ...input,
      ready_at: existing?.ready_at ?? now,
      last_seen_at: now,
    };

    await this.redis.set(
      this.key(input.worker_id),
      JSON.stringify(value),
      'EX',
      WorkerConnectionQrCodeReadinessService.TTL_SECONDS
    );

    recordConnectionLifecycle({
      stage: 'connection.worker.qrcode_consumer.readiness_heartbeat',
      decision: 'mark_qrcode_consumer_ready',
      outcome: 'ready',
      worker_id: input.worker_id,
      account_id: input.account_id,
      worker_type: input.worker_type_id,
      worker_type_id: input.worker_type_id,
      topic: input.topic,
      group_id: input.group_id,
      ready_at: value.ready_at,
      last_seen_at: value.last_seen_at,
    });
  }

  startHeartbeat(
    input: WorkerConnectionQrCodeConsumerReadinessInput
  ): () => void {
    let stopped = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const beat = () => {
      if (stopped) {
        return;
      }
      void this.markReady(input).catch((error) => {
        recordConnectionLifecycle({
          stage: 'connection.worker.qrcode_consumer.readiness_error',
          decision: 'mark_qrcode_consumer_ready',
          outcome: 'error',
          level: 'warn',
          worker_id: input.worker_id,
          account_id: input.account_id,
          worker_type: input.worker_type_id,
          worker_type_id: input.worker_type_id,
          topic: input.topic,
          group_id: input.group_id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    beat();
    interval = setInterval(
      beat,
      WorkerConnectionQrCodeReadinessService.HEARTBEAT_INTERVAL_MS
    );
    interval.unref?.();

    return () => {
      stopped = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }

  async read(
    workerId: string
  ): Promise<WorkerConnectionQrCodeConsumerReadiness | null> {
    const raw = await this.redis.get(this.key(workerId));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as WorkerConnectionQrCodeConsumerReadiness;
    } catch {
      return null;
    }
  }

  async isReady(input: {
    worker_id: string;
    account_id?: string;
    worker_type_id?: string;
  }): Promise<boolean> {
    const value = await this.read(input.worker_id);
    const ready = Boolean(
      value &&
      value.worker_id === input.worker_id &&
      (!input.account_id || value.account_id === input.account_id) &&
      (!input.worker_type_id || value.worker_type_id === input.worker_type_id)
    );

    recordConnectionLifecycle({
      stage: 'connection.manager.qrcode_consumer.readiness_check',
      decision: 'read_qrcode_consumer_readiness',
      outcome: ready ? 'ready' : 'not_ready',
      level: ready ? 'info' : 'warn',
      worker_id: input.worker_id,
      account_id: input.account_id,
      worker_type: input.worker_type_id,
      worker_type_id: input.worker_type_id,
      ready_account_id: value?.account_id,
      ready_worker_type_id: value?.worker_type_id,
      ready_topic: value?.topic,
      ready_group_id: value?.group_id,
      ready_last_seen_at: value?.last_seen_at,
    });

    return ready;
  }

  async waitUntilReady(
    input: {
      worker_id: string;
      account_id?: string;
      worker_type_id?: string;
    },
    timeoutMs = 30_000,
    intervalMs = 500
  ): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isReady(input)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    recordConnectionLifecycle({
      stage: 'connection.manager.qrcode_consumer.readiness_timeout',
      decision: 'wait_qrcode_consumer_readiness',
      outcome: 'timeout',
      level: 'warn',
      worker_id: input.worker_id,
      account_id: input.account_id,
      worker_type: input.worker_type_id,
      worker_type_id: input.worker_type_id,
      deadline_ms: timeoutMs,
      duration_ms: Date.now() - startedAt,
    });

    return false;
  }
}
