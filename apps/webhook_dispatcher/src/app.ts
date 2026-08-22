import dbElasticConnector from '@core/plugins/dbElastic';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import {
  OutboundWebhookDispatcherService,
  type OutboundWebhookDispatcherLogger,
} from '@core/services/outboundWebhookDispatcher.service';
import { DrizzleOutboundWebhookDispatcherStore } from '@core/services/outboundWebhookDispatcherStore';
import {
  createTelemetryOutboundWebhookDispatcherStore,
  isWebhookDispatcherDeliveryReady,
  type WebhookDispatcherClaimHealth,
  type WebhookDispatcherRuntimeState,
  type WebhookDispatcherTelemetrySnapshot,
} from '@core/services/outboundWebhookDispatcherTelemetryStore';
import { OutboundWebhookEventRecoveryService } from '@core/services/outboundWebhookEventRecovery.service';
import { OutboundWebhookEventService } from '@core/services/outboundWebhookEvent.service';
import { PlanEntitlementRepository } from '@core/repositories/planEntitlement/PlanEntitlement.repository';
import { planEntitlementTelemetryStore } from '@core/services/planEntitlementTelemetryStore';
import { runWithPostgresTransactionAdvisoryLock } from '@core/services/webhookDispatcherTransactionAdvisoryLock';
import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import {
  readWebhookDispatcherRuntimeConfig,
  type WebhookDispatcherRuntimeConfig,
} from './config';
import { createPeriodicTask, type PeriodicTask } from './periodicTask';
import { createWebhookDispatcherDatabasePlugin } from './plugins/database';

const RECOVERY_INTERVAL_MS = 30_000;
const RETENTION_INTERVAL_MS = 60_000;
const RETENTION_BATCH_SIZE = 1_000;
const RETENTION_MAX_BATCHES_PER_RUN = 10;
const RETENTION_TIME_BUDGET_MS = 5_000;
const DISPATCHER_WATCHDOG_INTERVAL_MS = 5_000;
const CLAIM_FAILURE_READINESS_THRESHOLD = 5;
const TELEMETRY_INTERVAL_MS = 60_000;
const READINESS_TIMEOUT_MS = 2_000;
const RECOVERY_ADVISORY_LOCK_ID = 1_876_421_337;

interface RetentionCountRow {
  readonly deleted_count: number | string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const waitForEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const createDispatcherLogger = (
  server: FastifyInstance
): OutboundWebhookDispatcherLogger => ({
  debug: (context, message) => server.log.debug(context, message),
  info: (context, message) => server.log.info(context, message),
  warn: (context, message) => server.log.warn(context, message),
  error: (context, message) => server.log.error(context, message),
});

/** Builds the production worker and its internal health server. */
export const buildWebhookDispatcherApp = (
  config: WebhookDispatcherRuntimeConfig = readWebhookDispatcherRuntimeConfig()
): FastifyInstance => {
  const server = fastify({
    logger: {
      level: 'info',
      redact: {
        censor: '[REDACTED]',
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'password',
          'secret',
          'signature',
          '*.password',
          '*.secret',
          '*.signature',
        ],
      },
    },
    disableRequestLogging: true,
    bodyLimit: 1_024,
    connectionTimeout: 10_000,
    keepAliveTimeout: 10_000,
    requestTimeout: 10_000,
    forceCloseConnections: 'idle',
    return503OnClosing: true,
  });
  let runtimeState: WebhookDispatcherRuntimeState = 'starting';
  let dispatcher: OutboundWebhookDispatcherService | null = null;
  let workerFailure: string | null = null;
  let readinessQuery: Promise<boolean> | null = null;
  let lastDatabaseReadiness: boolean | null = null;
  let lastDispatcherReadiness: boolean | null = null;
  let readClaimHealth: (() => WebhookDispatcherClaimHealth) | null = null;
  let flushTelemetry: (() => WebhookDispatcherTelemetrySnapshot | null) | null =
    null;
  const backgroundTasks: PeriodicTask[] = [];

  server.register(createWebhookDispatcherDatabasePlugin(config));
  server.register(dbElasticConnector);

  server.addHook('onSend', async (_request, reply): Promise<void> => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  const healthSchema = {
    response: {
      200: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', const: 'ok' } },
      },
      503: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', const: 'unhealthy' } },
      },
    },
  } as const;
  const healthHandler = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    if (workerFailure) {
      return reply.code(503).send({ status: 'unhealthy' });
    }
    return reply.code(200).send({ status: 'ok' });
  };
  server.get('/health', { schema: healthSchema }, healthHandler);
  server.get('/health/check', { schema: healthSchema }, healthHandler);

  const readinessSchema = {
    response: {
      200: {
        type: 'object',
        required: ['status', 'checks'],
        properties: {
          status: { type: 'string', const: 'ready' },
          checks: {
            type: 'object',
            required: ['database', 'dispatcher'],
            properties: {
              database: { type: 'string', const: 'ok' },
              dispatcher: { type: 'string', const: 'ok' },
            },
          },
        },
      },
      503: {
        type: 'object',
        required: ['status', 'checks'],
        properties: {
          status: { type: 'string', const: 'not_ready' },
          checks: {
            type: 'object',
            required: ['database', 'dispatcher'],
            properties: {
              database: { type: 'string', enum: ['ok', 'failed'] },
              dispatcher: { type: 'string', enum: ['ok', 'failed'] },
            },
          },
        },
      },
    },
  } as const;

  const queryDatabaseReadiness = async (): Promise<boolean> => {
    if (!readinessQuery) {
      readinessQuery = server.DatabasePoolRw.query('SELECT 1 AS ready')
        .then(() => true)
        .catch((error: unknown) => {
          server.log.debug(
            { error: errorMessage(error) },
            'Webhook dispatcher database readiness check failed'
          );
          return false;
        })
        .finally(() => {
          readinessQuery = null;
        });
    }
    const activeQuery = readinessQuery;

    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        activeQuery,
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), READINESS_TIMEOUT_MS);
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const readinessHandler = async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    const isDatabaseReady = await queryDatabaseReadiness();
    const claimHealth = readClaimHealth?.();
    const isDispatcherReady = isWebhookDispatcherDeliveryReady({
      runtimeState,
      workerFailure,
      isLoopRunning: dispatcher?.isRunning === true,
      claimHealth: claimHealth ?? null,
    });
    if (lastDatabaseReadiness !== isDatabaseReady) {
      if (isDatabaseReady) {
        server.log.info(
          { ready: true },
          'Webhook dispatcher database readiness changed'
        );
      } else {
        server.log.warn(
          { ready: false },
          'Webhook dispatcher database readiness changed'
        );
      }
      lastDatabaseReadiness = isDatabaseReady;
    }
    if (lastDispatcherReadiness !== isDispatcherReady) {
      const context = {
        ready: isDispatcherReady,
        consecutive_claim_failures: claimHealth?.consecutiveFailures ?? null,
        claim_failure_threshold: claimHealth?.failureThreshold ?? null,
      };
      if (isDispatcherReady) {
        server.log.info(
          context,
          'Webhook dispatcher delivery readiness changed'
        );
      } else {
        server.log.warn(
          context,
          'Webhook dispatcher delivery readiness changed'
        );
      }
      lastDispatcherReadiness = isDispatcherReady;
    }

    const checks = {
      database: isDatabaseReady ? ('ok' as const) : ('failed' as const),
      dispatcher: isDispatcherReady ? ('ok' as const) : ('failed' as const),
    };
    if (!isDatabaseReady || !isDispatcherReady) {
      return reply.code(503).send({ status: 'not_ready', checks });
    }
    return reply.code(200).send({ status: 'ready', checks });
  };
  server.get('/ready', { schema: readinessSchema }, readinessHandler);
  server.get('/ready/check', { schema: readinessSchema }, readinessHandler);

  const purgeExpiredWebhookData = async (): Promise<void> => {
    const startedAt = Date.now();
    let deletedCount = 0;
    let completedBatches = 0;
    let lastBatchCount = 0;

    while (
      completedBatches < RETENTION_MAX_BATCHES_PER_RUN &&
      Date.now() - startedAt < RETENTION_TIME_BUDGET_MS
    ) {
      const result = await server.DatabasePoolRw.query<RetentionCountRow>(
        `WITH expired_events AS (
          SELECT outbound_webhook_event_id
          FROM outbound_webhook_event
          WHERE expires_at <= NOW()
          ORDER BY expires_at ASC, outbound_webhook_event_id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        ), deleted_events AS (
          DELETE FROM outbound_webhook_event AS event
          USING expired_events
          WHERE event.outbound_webhook_event_id =
            expired_events.outbound_webhook_event_id
          RETURNING event.outbound_webhook_event_id
        )
        SELECT COUNT(*)::integer AS deleted_count
        FROM deleted_events`,
        [RETENTION_BATCH_SIZE]
      );
      lastBatchCount = Number(result.rows[0]?.deleted_count ?? 0);
      deletedCount += lastBatchCount;
      completedBatches += 1;
      if (lastBatchCount < RETENTION_BATCH_SIZE) break;
      await waitForEventLoop();
    }

    if (deletedCount > 0) {
      const context = {
        deleted_count: deletedCount,
        batches: completedBatches,
        duration_ms: Date.now() - startedAt,
        backlog_may_remain: lastBatchCount === RETENTION_BATCH_SIZE,
      };
      if (context.backlog_may_remain) {
        server.log.warn(
          context,
          'Webhook retention cycle reached its work budget'
        );
      } else {
        server.log.info(context, 'Expired webhook history purged');
      }
    }
  };

  const logDispatcherTelemetry = (): void => {
    const snapshot = flushTelemetry?.();
    const entitlementSnapshot = planEntitlementTelemetryStore.flush();
    if (!snapshot && !entitlementSnapshot) return;

    const context = {
      ...(snapshot ? { outbound_webhook_dispatcher: snapshot } : {}),
      ...(entitlementSnapshot
        ? { plan_entitlement_telemetry: entitlementSnapshot }
        : {}),
    };
    if (
      snapshot?.claim_failures ||
      snapshot?.delivery_statuses.dead ||
      snapshot?.completions_lost ||
      snapshot?.lost_before_attempt ||
      entitlementSnapshot?.cache.database_failure ||
      entitlementSnapshot?.decisions.outbound_dispatcher.unavailable
    ) {
      server.log.warn(context, 'Outbound webhook dispatcher activity summary');
    } else {
      server.log.info(context, 'Outbound webhook dispatcher activity summary');
    }
  };

  server.addHook('onReady', async (): Promise<void> => {
    const secretDecryptor = new PasswordEncryptorService();
    const telemetryStore = createTelemetryOutboundWebhookDispatcherStore(
      new DrizzleOutboundWebhookDispatcherStore(
        server.DatabaseRw,
        config.databaseQueryTimeoutMs
      ),
      { claimFailureThreshold: CLAIM_FAILURE_READINESS_THRESHOLD }
    );
    flushTelemetry = telemetryStore.flush;
    readClaimHealth = telemetryStore.getClaimHealth;
    dispatcher = new OutboundWebhookDispatcherService({
      store: telemetryStore.store,
      secretDecryptor,
      logger: createDispatcherLogger(server),
      options: {
        concurrency: config.concurrency,
        leaseDurationMs: config.leaseDurationMs,
        pollIntervalMs: config.pollIntervalMs,
        requestTimeoutMs: config.requestTimeoutMs,
        isProduction: config.isProduction,
        allowLocalhostHttp: config.allowLocalhostHttp,
      },
    });
    dispatcher.start();
    if (!dispatcher.isRunning) {
      throw new Error('Outbound webhook dispatcher did not start');
    }

    const recovery = new OutboundWebhookEventRecoveryService(
      server.DatabaseRw,
      new ElasticDatabaseService(server.DatabaseElasticClient),
      new OutboundWebhookEventService(
        server.DatabaseRw,
        null,
        new PlanEntitlementRepository(server.DatabaseRw)
      )
    );
    const recoveryTask = createPeriodicTask({
      name: 'journal-recovery',
      intervalMs: RECOVERY_INTERVAL_MS,
      logger: server.log,
      run: async (): Promise<void> => {
        const locked = await runWithPostgresTransactionAdvisoryLock({
          pool: server.DatabasePoolRw,
          lockId: RECOVERY_ADVISORY_LOCK_ID,
          queryTimeoutMs: config.databaseQueryTimeoutMs,
          run: () => recovery.reconcile(),
        });
        if (!locked.acquired) return;

        const result = locked.value;
        if (result.failed > 0) {
          server.log.warn(
            { outbound_webhook_recovery: result },
            'Outbound webhook journal reconciliation completed with failures'
          );
        } else if (result.recovered || result.quarantined) {
          server.log.info(
            { outbound_webhook_recovery: result },
            'Outbound webhook journal reconciliation completed'
          );
        }
      },
    });
    const retentionTask = createPeriodicTask({
      name: 'history-retention',
      intervalMs: RETENTION_INTERVAL_MS,
      logger: server.log,
      run: purgeExpiredWebhookData,
    });
    const watchdogTask = createPeriodicTask({
      name: 'dispatcher-watchdog',
      intervalMs: DISPATCHER_WATCHDOG_INTERVAL_MS,
      logger: server.log,
      run: async (): Promise<void> => {
        if (
          runtimeState === 'running' &&
          !workerFailure &&
          dispatcher?.isRunning !== true
        ) {
          workerFailure = 'delivery_loop_stopped';
          server.log.fatal(
            { reason: workerFailure },
            'Outbound webhook dispatcher loop stopped unexpectedly'
          );
        }
      },
    });
    const telemetryTask = createPeriodicTask({
      name: 'activity-telemetry',
      intervalMs: TELEMETRY_INTERVAL_MS,
      logger: server.log,
      run: async (): Promise<void> => logDispatcherTelemetry(),
    });
    backgroundTasks.push(
      recoveryTask,
      retentionTask,
      watchdogTask,
      telemetryTask
    );
    runtimeState = 'running';
    backgroundTasks.forEach((task) => task.start());

    server.log.info(
      {
        concurrency: config.concurrency,
        database_pool_min: config.databasePoolMin,
        database_pool_max: config.databasePoolMax,
        database_query_timeout_ms: config.databaseQueryTimeoutMs,
        lease_duration_ms: config.leaseDurationMs,
        request_timeout_ms: config.requestTimeoutMs,
        claim_failure_readiness_threshold: CLAIM_FAILURE_READINESS_THRESHOLD,
      },
      'Webhook dispatcher runtime initialized'
    );
  });

  server.addHook('preClose', async (): Promise<void> => {
    runtimeState = 'stopping';
    await Promise.all([
      dispatcher?.stop() ?? Promise.resolve(),
      ...backgroundTasks.map((task) => task.stop()),
    ]);
    logDispatcherTelemetry();
  });

  server.addHook('onClose', async (): Promise<void> => {
    if ('DatabaseElasticClient' in server && server.DatabaseElasticClient) {
      await server.DatabaseElasticClient.close();
    }
  });

  return server;
};
