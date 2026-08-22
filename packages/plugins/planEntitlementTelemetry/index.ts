import {
  type PlanEntitlementTelemetrySnapshot,
  type PlanEntitlementTelemetryStore,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

export interface PlanEntitlementTelemetryPluginOptions {
  readonly intervalMs?: number;
  readonly store?: PlanEntitlementTelemetryStore;
}

const snapshotHasFailures = (
  snapshot: PlanEntitlementTelemetrySnapshot
): boolean => {
  if (
    snapshot.cache.database_failure > 0 ||
    snapshot.fences.install.error > 0 ||
    snapshot.fences.release.error > 0
  ) {
    return true;
  }

  return Object.values(snapshot.decisions).some(
    (decisions) => decisions.unavailable > 0
  );
};

/**
 * Flushes the in-process counters through the existing structured logger.
 * The interval is unref'd and always cleared by Fastify shutdown hooks.
 */
export const planEntitlementTelemetryPlugin = async (
  fastify: FastifyInstance,
  options: PlanEntitlementTelemetryPluginOptions = {}
): Promise<void> => {
  const store = options.store ?? planEntitlementTelemetryStore;
  const intervalMs = Math.max(
    1_000,
    Math.floor(options.intervalMs ?? DEFAULT_FLUSH_INTERVAL_MS)
  );
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    const snapshot = store.flush();
    if (!snapshot) return;

    const context = { plan_entitlement_telemetry: snapshot };
    if (snapshotHasFailures(snapshot)) {
      fastify.log.warn(context, 'Plan entitlement activity summary');
    } else {
      fastify.log.info(context, 'Plan entitlement activity summary');
    }
  };

  fastify.addHook('onReady', async (): Promise<void> => {
    timer = setInterval(flush, intervalMs);
    timer.unref();
  });

  fastify.addHook('onClose', async (): Promise<void> => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    flush();
  });
};

export default fp(planEntitlementTelemetryPlugin, {
  name: 'plan-entitlement-telemetry',
});
