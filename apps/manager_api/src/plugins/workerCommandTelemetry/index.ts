import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { container } from 'tsyringe';
import { WorkerCommandDeadlineRegistryService } from '@core/services/workerCommandDeadlineRegistry.service';
import {
  workerCommandTelemetryStore,
  type WorkerCommandTelemetryStore,
} from '@core/services/workerCommandTelemetryStore';

const SAMPLE_INTERVAL_MS = 60_000;

export interface WorkerCommandTelemetryPluginOptions {
  registry?: Pick<
    WorkerCommandDeadlineRegistryService,
    'admissionIdentityCount' | 'deadlineRecordCount'
  >;
  store?: WorkerCommandTelemetryStore;
  intervalMs?: number;
}

/**
 * Samples bounded Redis gauges and emits the cumulative low-cardinality
 * command-plane snapshot through the existing structured logger. Production
 * can translate this stable object to Prometheus or OTLP at the collector.
 */
export const workerCommandTelemetryPlugin: FastifyPluginAsync<
  WorkerCommandTelemetryPluginOptions
> = async (server, options: WorkerCommandTelemetryPluginOptions = {}) => {
  const registry =
    options.registry ?? container.resolve(WorkerCommandDeadlineRegistryService);
  const store = options.store ?? workerCommandTelemetryStore;
  const intervalMs = Math.max(1_000, options.intervalMs ?? SAMPLE_INTERVAL_MS);
  let timer: ReturnType<typeof setInterval> | null = null;

  const sample = async (): Promise<void> => {
    try {
      const [admissionIdentities, deadlineRecords] = await Promise.all([
        registry.admissionIdentityCount(),
        registry.deadlineRecordCount(),
      ]);
      store.setRedisGauges({
        admissionIdentities,
        deadlineRecords,
      });
      server.log.info(
        { worker_command_telemetry: store.snapshot() },
        'Worker command plane telemetry snapshot'
      );
    } catch (error) {
      store.recordRedisGaugeError();
      server.log.warn(
        { err: error, type: 'worker_command_telemetry_sample_failed' },
        'Worker command plane telemetry sampling failed'
      );
    }
  };

  server.addHook('onReady', async () => {
    await sample();
    timer = setInterval(() => void sample(), intervalMs);
    timer.unref?.();
  });

  server.addHook('onClose', () => {
    if (timer) clearInterval(timer);
    timer = null;
  });
};

export default fp(workerCommandTelemetryPlugin, {
  name: 'worker-command-telemetry',
  dependencies: ['redis'],
});
