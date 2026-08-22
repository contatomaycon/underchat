import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { startWorkerCommandIngressWwebjsConsume } from './workerCommandIngress.consume';
import { startConnectionQrCodeWwebjsConsume } from './connectionQrCode.consume';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WwebjsHealthCheckService } from '@core/services/wwebjs/methods/healthCheck.service';
import { WwebjsService } from '@core/services/wwebjs';
import { WorkerSelfMonitorService } from '@core/services/workerSelfMonitor.service';
import { WorkerRuntimeDatabaseService } from '@core/services/workerRuntimeDatabase.service';
import { WorkerDatabaseAvailabilityGuard } from '@core/services/workerDatabaseAvailabilityGuard.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  getKafkaConsumerHealthSnapshots,
  getWorkerConsumers,
  hasUnhealthyKafkaConsumer,
  type IWorkerConsumer,
  reconcileKafkaConsumers,
  registerWorkerConsumer,
  setKafkaConsumersProviderReady,
  startKafkaConsumerSupervisor,
  unregisterWorkerConsumer,
  waitForKafkaConsumersReady,
} from './registry';
import { wwebjsEnvironment } from '@core/config/environments';
import {
  emitWorkerProviderRuntimeState,
  getWorkerProviderRuntimeState,
  subscribeWorkerProviderRuntimeDesiredState,
  subscribeWorkerProviderRuntimeState,
} from '@core/common/functions/workerProviderRuntimeState';
import { isWorkerKafkaDispatchAuthorized } from '@core/common/functions/workerKafkaDispatchAuthorization';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';

let deferredConsumersStarted = false;
let deferredConsumersPromise: Promise<boolean> | null = null;
let providerRuntimeReady = false;
let runtimeClosing = false;
let databaseSuspended = false;
let runtimeConsumerControlPlaneStarted = false;
let runtimeBootstrapTransitionPromise: Promise<void> | null = null;
let runtimeBootstrapTransitionGeneration: number | null = null;
let runtimeLifecycleGeneration = 0;
let runtimeIngressCleanupRequired = false;
let runtimeIngressCleanupPromise: Promise<void> | null = null;
let databaseAvailabilityGuard: WorkerDatabaseAvailabilityGuard | null = null;
let unsubscribeSessionLeaseLost: (() => void) | null = null;
let databaseRecoveryFenceEpoch: string | null = null;
let qrStreamStartupPromise: Promise<void> | null = null;
let qrConsumerStarting: IWorkerConsumer | null = null;
let qrConsumerRegistered: IWorkerConsumer | null = null;
let qrConsumerClosePromise: Promise<void> | null = null;
let qrRegisteredClosePromise: Promise<void> | null = null;
let qrConsumerSuspended = false;
let qrConsumerDiscardRequired = false;
const deferredConsumersStarting = new Set<IWorkerConsumer>();
type WorkerCommandIngressRole = 'worker_command_ingress';
type DeferredConsumerStartupOwnership = {
  role: WorkerCommandIngressRole;
  token: symbol;
};
type StartedDeferredConsumer = DeferredConsumerStartupOwnership & {
  consumer: IWorkerConsumer;
};
const deferredConsumerStartupOwnership = new WeakMap<
  IWorkerConsumer,
  DeferredConsumerStartupOwnership
>();
const deferredConsumerClosePromises = new WeakMap<
  IWorkerConsumer,
  Promise<void>
>();
const closedDeferredConsumers = new WeakSet<IWorkerConsumer>();

function isProviderRuntimeStillReady(): boolean {
  return (
    !runtimeClosing &&
    !databaseSuspended &&
    providerRuntimeReady &&
    getWorkerProviderRuntimeState('wwebjs') !== false
  );
}

function logDeferredConsumerCleanupFailure(
  server: FastifyInstance,
  role: WorkerCommandIngressRole | 'unknown',
  stage: 'cancel' | 'late' | 'provider_unavailable'
): void {
  server.log.error(
    { role, failure_code: 'cleanup_failed', stage },
    'WWebJS: falha ao limpar consumidor Kafka durante startup'
  );
}

function closeStartingQrConsumer(): Promise<void> {
  if (!qrConsumerStarting) {
    return Promise.resolve();
  }
  if (qrConsumerClosePromise) {
    return qrConsumerClosePromise;
  }

  const consumer = qrConsumerStarting;
  const closing = Promise.resolve()
    .then(() => consumer.close?.())
    .then(() => {
      if (qrConsumerStarting === consumer) {
        qrConsumerStarting = null;
      }
    })
    .finally(() => {
      if (qrConsumerClosePromise === closing) {
        qrConsumerClosePromise = null;
      }
    });
  qrConsumerClosePromise = closing;
  return closing;
}

function closeDeferredConsumer(consumer: IWorkerConsumer): Promise<void> {
  if (closedDeferredConsumers.has(consumer)) {
    return Promise.resolve();
  }
  const existing = deferredConsumerClosePromises.get(consumer);
  if (existing) {
    return existing;
  }

  const closing = Promise.resolve()
    .then(() => consumer.close?.())
    .then(() => {
      closedDeferredConsumers.add(consumer);
      deferredConsumersStarting.delete(consumer);
    })
    .finally(() => {
      if (deferredConsumerClosePromises.get(consumer) === closing) {
        deferredConsumerClosePromises.delete(consumer);
      }
    });
  deferredConsumerClosePromises.set(consumer, closing);
  return closing;
}

async function cancelDeferredConsumerStartup(
  server: FastifyInstance,
  requireSuccess = false
): Promise<void> {
  const startingConsumers = Array.from(deferredConsumersStarting);
  const ownership = startingConsumers.map((consumer) =>
    deferredConsumerStartupOwnership.get(consumer)
  );
  const results = await Promise.allSettled(
    startingConsumers.map((consumer, index) =>
      closeAndUnregisterDeferredConsumer(consumer, ownership[index]?.token)
    )
  );
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      return;
    }
    logDeferredConsumerCleanupFailure(
      server,
      ownership[index]?.role ?? 'unknown',
      'cancel'
    );
  });

  const failureCount = results.filter(
    (result) => result.status === 'rejected'
  ).length;
  if (requireSuccess && failureCount > 0) {
    throw new Error(
      `Wwebjs: ${failureCount} consumidor(es) Kafka remanescente(s) não puderam ser encerrados`
    );
  }
}

type DeferredConsumerStarter = (
  onCreated: (consumer: IWorkerConsumer) => void
) => Promise<IWorkerConsumer>;

type DeferredConsumerStartupFailure = {
  role: WorkerCommandIngressRole;
  error: unknown;
};

function resolveDeferredConsumerStartupTimeoutMs(): number {
  const configured = Number(
    process.env.WORKER_COMMAND_INGRESS_STARTUP_TIMEOUT_MS
  );
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1000, Math.floor(configured))
    : 30_000;
}

function classifyDeferredConsumerStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('wwebjs_kafka_consumer_startup_timeout:')) {
    return 'startup_timeout';
  }
  if (message.startsWith('wwebjs_kafka_consumer_identity_changed:')) {
    return 'consumer_identity_changed';
  }
  if (
    message === 'wwebjs_provider_became_unavailable_during_consumer_startup'
  ) {
    return 'provider_unavailable';
  }
  if (message.startsWith('wwebjs_kafka_consumer_startup_cleanup_failed:')) {
    return 'cleanup_failed';
  }
  if (message.startsWith('wwebjs_kafka_consumer_start_failed:')) {
    const safeCode = [
      'startup_timeout',
      'consumer_identity_changed',
      'provider_unavailable',
      'consumer_start_error',
      'non_error_rejection',
    ].find((code) => message.endsWith(`:code=${code}`));
    return safeCode ?? 'consumer_start_failed';
  }
  return error instanceof Error
    ? 'consumer_start_error'
    : 'non_error_rejection';
}

function withDeferredConsumerStartupTimeout<T>(
  role: WorkerCommandIngressRole,
  promise: Promise<T>
): Promise<T> {
  const timeoutMs = resolveDeferredConsumerStartupTimeoutMs();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          `wwebjs_kafka_consumer_startup_timeout:role=${role}:timeout_ms=${timeoutMs}`
        )
      );
    }, timeoutMs);
    timeout.unref?.();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

async function closeAndUnregisterDeferredConsumer(
  consumer: IWorkerConsumer,
  expectedOwnershipToken?: symbol
): Promise<void> {
  if (
    expectedOwnershipToken &&
    deferredConsumerStartupOwnership.get(consumer)?.token !==
      expectedOwnershipToken
  ) {
    return;
  }
  try {
    await closeDeferredConsumer(consumer);
  } catch (error) {
    // Keep failed cleanup discoverable and retryable before another batch.
    deferredConsumersStarting.add(consumer);
    throw error;
  }
  if (
    expectedOwnershipToken &&
    deferredConsumerStartupOwnership.get(consumer)?.token !==
      expectedOwnershipToken
  ) {
    return;
  }
  // closeDeferredConsumer short-circuits for an already-closed owner. Always
  // clear a late duplicate callback from the startup set as well.
  deferredConsumersStarting.delete(consumer);
  unregisterWorkerConsumer(consumer);
}

async function startTrackedDeferredConsumer(
  server: FastifyInstance,
  role: WorkerCommandIngressRole,
  start: DeferredConsumerStarter
): Promise<StartedDeferredConsumer> {
  const ownership: DeferredConsumerStartupOwnership = {
    role,
    token: Symbol(role),
  };
  let trackedConsumer: IWorkerConsumer | null = null;
  let resolvedConsumer: IWorkerConsumer | null = null;
  let startupSettled = false;
  let startupCancelled = false;
  const discardSettledConsumer = (consumer: IWorkerConsumer): void => {
    const currentOwnership = deferredConsumerStartupOwnership.get(consumer);
    if (currentOwnership && currentOwnership.token !== ownership.token) {
      return;
    }
    deferredConsumerStartupOwnership.set(consumer, ownership);
    closedDeferredConsumers.delete(consumer);
    deferredConsumersStarting.add(consumer);
    void closeAndUnregisterDeferredConsumer(consumer, ownership.token).catch(
      () => logDeferredConsumerCleanupFailure(server, role, 'late')
    );
  };
  const track = (consumer: IWorkerConsumer): void => {
    if (startupSettled) {
      if (!startupCancelled && trackedConsumer === consumer) {
        return;
      }
      discardSettledConsumer(consumer);
      return;
    }
    if (trackedConsumer && trackedConsumer !== consumer) {
      discardSettledConsumer(consumer);
      throw new Error(`wwebjs_kafka_consumer_identity_changed:role=${role}`);
    }
    if (trackedConsumer === consumer) {
      return;
    }
    trackedConsumer = consumer;
    deferredConsumerStartupOwnership.set(consumer, ownership);
    closedDeferredConsumers.delete(consumer);
    deferredConsumersStarting.add(consumer);
    if (!isProviderRuntimeStillReady()) {
      void closeAndUnregisterDeferredConsumer(consumer, ownership.token).catch(
        () =>
          logDeferredConsumerCleanupFailure(
            server,
            role,
            'provider_unavailable'
          )
      );
    }
  };

  try {
    const startupPromise = start(track);
    void startupPromise.then(
      (consumer) => {
        if (startupSettled && startupCancelled) {
          discardSettledConsumer(consumer);
        }
      },
      () => undefined
    );
    const consumer = await withDeferredConsumerStartupTimeout(
      role,
      startupPromise
    );
    resolvedConsumer = consumer;
    if (!trackedConsumer) {
      track(consumer);
    }
    if (trackedConsumer !== consumer) {
      const resolvedOwnership = deferredConsumerStartupOwnership.get(consumer);
      if (!resolvedOwnership) {
        deferredConsumerStartupOwnership.set(consumer, ownership);
        closedDeferredConsumers.delete(consumer);
        deferredConsumersStarting.add(consumer);
      }
      throw new Error(`wwebjs_kafka_consumer_identity_changed:role=${role}`);
    }
    if (!isProviderRuntimeStillReady()) {
      closedDeferredConsumers.delete(consumer);
      deferredConsumersStarting.add(consumer);
      await closeAndUnregisterDeferredConsumer(consumer, ownership.token);
      throw new Error(
        'wwebjs_provider_became_unavailable_during_consumer_startup'
      );
    }
    startupSettled = true;
    return { consumer, ...ownership };
  } catch (error) {
    startupCancelled = true;
    startupSettled = true;
    const cleanupCandidates = Array.from(
      new Set(
        [trackedConsumer, resolvedConsumer].filter(
          (consumer): consumer is IWorkerConsumer => consumer !== null
        )
      )
    );
    const cleanupResults = await Promise.allSettled(
      cleanupCandidates.map((consumer) =>
        closeAndUnregisterDeferredConsumer(consumer, ownership.token)
      )
    );
    const cleanupFailure = cleanupResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (cleanupFailure) {
      throw new Error(
        `wwebjs_kafka_consumer_startup_cleanup_failed:role=${role}:startup_code=${classifyDeferredConsumerStartupError(error)}:cleanup_code=${classifyDeferredConsumerStartupError(cleanupFailure.reason)}`
      );
    }
    throw new Error(
      `wwebjs_kafka_consumer_start_failed:role=${role}:code=${classifyDeferredConsumerStartupError(error)}`
    );
  }
}

export async function startConsumers(server: FastifyInstance): Promise<void> {
  if (runtimeClosing || databaseSuspended) {
    throw new Error('wwebjs_runtime_is_closing');
  }

  await ensureQrStreamStarted(server);
  if (runtimeClosing || databaseSuspended) {
    throw new Error('wwebjs_runtime_is_closing');
  }
  startKafkaConsumerSupervisor(server.log);
  // The monitor must survive an initial Kafka readiness timeout. The
  // supervisor can reconcile consumers asynchronously after this activation
  // attempt rejects; starting the singleton monitor first guarantees that the
  // recovered runtime is still observed without requiring another external
  // activation event.
  startWorkerSelfMonitor(server);
  await ensureDeferredConsumersStarted(server);
  if (runtimeClosing || databaseSuspended) {
    throw new Error('wwebjs_runtime_is_closing');
  }
}

async function ensureQrStreamStarted(server: FastifyInstance): Promise<void> {
  if (server.qrStreamReady) {
    return;
  }
  if (runtimeClosing || databaseSuspended) {
    throw new Error('wwebjs_runtime_is_closing');
  }
  if (qrConsumerRegistered) {
    await resumeQrStream(server);
    return;
  }

  if (!qrStreamStartupPromise) {
    qrStreamStartupPromise = (async () => {
      await closeStartingQrConsumer();
      const consumer = await startConnectionQrCodeWwebjsConsume(server);
      qrConsumerStarting = consumer;
      if (runtimeClosing || databaseSuspended) {
        await closeStartingQrConsumer();
        throw new Error('wwebjs_runtime_is_closing');
      }

      try {
        registerWorkerConsumer(consumer, { monitorKafkaHealth: false });
        server.qrStreamReady = true;
        qrConsumerRegistered = consumer;
        qrConsumerSuspended = false;
        qrConsumerDiscardRequired = false;
        qrConsumerStarting = null;
      } catch (err) {
        await closeStartingQrConsumer();
        throw err;
      }
    })()
      .catch((err) => {
        server.qrStreamReady = false;
        server.log.error({ err }, 'Erro ao iniciar consumidor Redis de QR');
        throw err;
      })
      .finally(() => {
        qrStreamStartupPromise = null;
      });
  }

  await qrStreamStartupPromise;
}

async function suspendQrStream(server: FastifyInstance): Promise<void> {
  server.qrStreamReady = false;
  await closeStartingQrConsumer();
  const consumer = qrConsumerRegistered;
  if (!consumer || qrConsumerSuspended) {
    return;
  }
  if (qrRegisteredClosePromise) {
    await qrRegisteredClosePromise;
    return;
  }

  const closing = Promise.resolve()
    .then(() => consumer.close?.())
    .then(() => {
      if (qrConsumerRegistered === consumer) {
        qrConsumerSuspended = true;
      }
    })
    .finally(() => {
      if (qrRegisteredClosePromise === closing) {
        qrRegisteredClosePromise = null;
      }
    });
  qrRegisteredClosePromise = closing;
  await closing;
}

async function closeAndDiscardQrStream(server: FastifyInstance): Promise<void> {
  qrConsumerDiscardRequired = true;
  await suspendQrStream(server);
  const consumer = qrConsumerRegistered;
  if (!consumer) {
    qrConsumerDiscardRequired = false;
    return;
  }
  unregisterWorkerConsumer(consumer);
  if (qrConsumerRegistered === consumer) {
    qrConsumerRegistered = null;
    qrConsumerSuspended = false;
  }
  qrConsumerDiscardRequired = false;
}

async function resumeQrStream(server: FastifyInstance): Promise<void> {
  if (runtimeClosing || databaseSuspended) {
    throw new Error('wwebjs_runtime_is_closing');
  }
  if (qrConsumerDiscardRequired) {
    await closeAndDiscardQrStream(server);
  }
  if (qrConsumerRegistered?.execute) {
    await qrConsumerRegistered.execute();
    qrConsumerSuspended = false;
    server.qrStreamReady = true;
    return;
  }
  if (qrConsumerRegistered) {
    await closeAndDiscardQrStream(server);
  }
  await ensureQrStreamStarted(server);
}

function ensureDatabaseAvailabilityGuard(server: FastifyInstance): void {
  if (databaseAvailabilityGuard || runtimeClosing) {
    return;
  }

  const runtimeGeneration = Number(wwebjsEnvironment.runtimeGeneration);
  if (!Number.isSafeInteger(runtimeGeneration) || runtimeGeneration <= 0) {
    throw new Error('wwebjs_database_guard_runtime_generation_invalid');
  }

  const runtimeDatabaseService = container.resolve(
    WorkerRuntimeDatabaseService
  );
  databaseAvailabilityGuard = new WorkerDatabaseAvailabilityGuard({
    provider: 'wwebjs',
    log: server.log,
    onSuspend: async () => {
      databaseSuspended = true;
      runtimeLifecycleGeneration += 1;
      cancelWwebjsRuntimeActivationRetry();
      providerRuntimeReady = false;
      databaseRecoveryFenceEpoch = null;
      container.resolve(WorkerSelfMonitorService).stop();

      const results = await Promise.allSettled([
        emitWorkerProviderRuntimeState('wwebjs', false),
        cancelDeferredConsumerStartup(server, true),
        setKafkaConsumersProviderReady(false, server.log),
        suspendQrStream(server),
        container.resolve(WwebjsService).shutdown(),
      ]);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('wwebjs_database_suspension_incomplete');
      }
    },
    reacquireFence: async () => {
      const owned =
        await runtimeDatabaseService.resolveWhatsappRuntimeOwnedConnectionFence(
          {
            worker_id: wwebjsEnvironment.wwebjsWorkerId,
            account_id: wwebjsEnvironment.wwebjsAccountId,
            source_provider: 'wwebjs',
            runtime_generation: runtimeGeneration,
          }
        );
      const connectionEpoch =
        owned?.connection_epoch ??
        databaseRecoveryFenceEpoch ??
        (databaseRecoveryFenceEpoch = randomUUID());
      databaseRecoveryFenceEpoch = connectionEpoch;
      await runtimeDatabaseService.activateWhatsappRuntimeFence({
        worker_id: wwebjsEnvironment.wwebjsWorkerId,
        account_id: wwebjsEnvironment.wwebjsAccountId,
        source_provider: 'wwebjs',
        runtime_generation: runtimeGeneration,
        connection_epoch: connectionEpoch,
        connection_attempt_id: owned?.connection_attempt_id,
      });
    },
    onResume: async () => {
      const wwebjsService = container.resolve(WwebjsService);
      const leaseRecoveryGeneration =
        wwebjsService.beginSessionLeaseRecoveryResume();
      try {
        const staleTransition = runtimeBootstrapTransitionPromise;
        if (
          staleTransition &&
          runtimeBootstrapTransitionGeneration !== runtimeLifecycleGeneration
        ) {
          await Promise.allSettled([staleTransition]);
        }
        if (runtimeClosing) {
          throw new Error('wwebjs_runtime_is_closing');
        }
        databaseSuspended = false;
        await prepareWwebjsRuntime(server, { resumeExisting: true });
        if (
          leaseRecoveryGeneration !== undefined &&
          (!wwebjsService.startSessionLeaseRecoverySocket(
            leaseRecoveryGeneration
          ) ||
            !wwebjsService.markSessionLeaseRecoveryCompleted(
              leaseRecoveryGeneration
            ))
        ) {
          throw new Error('wwebjs_session_lease_recovery_fence_changed');
        }
        activationRetryAttempt = 0;
        databaseRecoveryFenceEpoch = null;
      } catch {
        wwebjsService.abortSessionLeaseRecoveryResume(leaseRecoveryGeneration);
        databaseSuspended = true;
        cancelWwebjsRuntimeActivationRetry();
        providerRuntimeReady = false;
        container.resolve(WorkerSelfMonitorService).stop();
        await Promise.allSettled([
          emitWorkerProviderRuntimeState('wwebjs', false),
          cancelDeferredConsumerStartup(server),
          setKafkaConsumersProviderReady(false, server.log),
          suspendQrStream(server),
          wwebjsService.shutdown(),
        ]);
        throw new Error('wwebjs_database_resume_incomplete');
      }
    },
  });
  const guard = databaseAvailabilityGuard;
  unsubscribeSessionLeaseLost?.();
  unsubscribeSessionLeaseLost = container
    .resolve(WwebjsService)
    .onSessionLeaseLost(async () => {
      if (runtimeClosing || databaseAvailabilityGuard !== guard) return;
      await guard.reportSessionLeaseLost();
    });
  databaseAvailabilityGuard.start();
}

function startWorkerSelfMonitor(server: FastifyInstance): void {
  const monitor = container.resolve(WorkerSelfMonitorService);
  const healthCheckService = container.resolve(WwebjsHealthCheckService);
  const wwebjsService = container.resolve(WwebjsService);
  monitor.start({
    provider: EWorkerType.wwebjs,
    workerId: wwebjsEnvironment.wwebjsWorkerId,
    accountId: wwebjsEnvironment.wwebjsAccountId,
    workerTypeId: EWorkerType.wwebjs,
    runtimeGeneration: wwebjsEnvironment.runtimeGeneration,
    warmStandby: wwebjsEnvironment.isWarmStandby,
    getReadiness: async () => {
      const readiness = await healthCheckService.verifyCurrentSession();
      const recoverableSession = wwebjsService.canRecoverRestorableSession();
      if (readiness.session_ready !== true && recoverableSession) {
        wwebjsService.ensureRestorableSessionRecovery(
          `self_monitor:${readiness.provider_state ?? 'runtime_not_ready'}`
        );
      }
      return {
        ...readiness,
        recoverable_session: recoverableSession,
      };
    },
    hasUnhealthyKafkaConsumer,
    isKafkaDispatchAuthorized: isWorkerKafkaDispatchAuthorized,
    getKafkaConsumerHealthSnapshots,
    log: server.log,
  });
}

async function ensureDeferredConsumersStarted(
  server: FastifyInstance
): Promise<boolean> {
  if (deferredConsumersStarted) {
    if (isProviderRuntimeStillReady()) {
      await setKafkaConsumersProviderReady(true, server.log);
      await waitForDeferredConsumersReady(server);
    }
    return true;
  }

  if (!deferredConsumersPromise) {
    deferredConsumersPromise = startDeferredConsumers(server)
      .then((started) => {
        deferredConsumersStarted = started;
        return started;
      })
      .finally(() => {
        deferredConsumersPromise = null;
      });
  }

  const started = await deferredConsumersPromise;
  if (started && isProviderRuntimeStillReady()) {
    await setKafkaConsumersProviderReady(true, server.log);
    await waitForDeferredConsumersReady(server);
  }
  return started;
}

async function waitForDeferredConsumersReady(
  server: FastifyInstance
): Promise<void> {
  try {
    await waitForKafkaConsumersReady({
      shouldContinue: isProviderRuntimeStillReady,
    });
  } catch (error) {
    if (
      !isKafkaConsumerReadinessTimeout(error) ||
      !isProviderRuntimeStillReady()
    ) {
      throw error;
    }

    try {
      await reconcileKafkaConsumers(server.log, 'readiness_timeout');
    } catch (reconciliationError) {
      server.log.error(
        { err: reconciliationError, readiness_error: error },
        'Wwebjs: falha ao reconciliar consumidores após timeout de readiness'
      );
    }
    throw error;
  }
}

function isKafkaConsumerReadinessTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith('kafka_consumers_not_ready:')
  );
}

async function startDeferredConsumers(
  server: FastifyInstance
): Promise<boolean> {
  await cancelDeferredConsumerStartup(server, true);
  if (runtimeClosing) {
    return false;
  }

  const readiness = await container
    .resolve(WwebjsHealthCheckService)
    .verifyCurrentSession();
  providerRuntimeReady =
    readiness.session_ready === true &&
    readiness.can_send === true &&
    readiness.can_receive_runtime === true &&
    readiness.authenticated === true;

  if (!isProviderRuntimeStillReady()) {
    await setKafkaConsumersProviderReady(false, server.log);
    return false;
  }

  // A late first provider-ready transition leaves the registry applied as
  // stopped. Align it before the starters execute so the newly-created
  // consumers are not immediately executed a second time by the registry.
  await setKafkaConsumersProviderReady(true, server.log);
  if (!isProviderRuntimeStillReady()) {
    await setKafkaConsumersProviderReady(false, server.log);
    return false;
  }

  const starters = {
    worker_command_ingress: (onCreated) =>
      startWorkerCommandIngressWwebjsConsume(server, onCreated),
  } satisfies Record<WorkerCommandIngressRole, DeferredConsumerStarter>;

  const entries = Object.entries(starters) as Array<
    [WorkerCommandIngressRole, DeferredConsumerStarter]
  >;
  const results = await Promise.allSettled(
    entries.map(([role, start]) =>
      startTrackedDeferredConsumer(server, role, start)
    )
  );
  const startedEntries = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : []
  );
  const failures = results.flatMap(
    (result, index): DeferredConsumerStartupFailure[] =>
      result.status === 'rejected'
        ? [{ role: entries[index][0], error: result.reason }]
        : []
  );

  if (!isProviderRuntimeStillReady() || failures.length > 0) {
    const cleanupResults = await Promise.allSettled(
      startedEntries.map(({ consumer, token }) =>
        closeAndUnregisterDeferredConsumer(consumer, token)
      )
    );
    const cleanupFailureRoles = cleanupResults.flatMap((result, index) =>
      result.status === 'rejected' ? [startedEntries[index].role] : []
    );
    if (failures.length > 0 || cleanupFailureRoles.length > 0) {
      server.log.error(
        {
          startup_failed_roles: failures.map((failure) => failure.role),
          startup_failure_codes: failures.map((failure) =>
            classifyDeferredConsumerStartupError(failure.error)
          ),
          cleanup_failed_roles: cleanupFailureRoles,
          cleanup_failure_codes: cleanupFailureRoles.map(
            () => 'cleanup_failed'
          ),
        },
        'WWebJS: startup do lote Kafka não foi concluído'
      );
    }
    if (cleanupFailureRoles.length > 0) {
      throw new Error(
        `wwebjs_kafka_consumer_batch_cleanup_failed:roles=${cleanupFailureRoles.join(',')}`
      );
    }
    if (!isProviderRuntimeStillReady()) {
      return false;
    }
    throw failures[0].error;
  }

  if (!isProviderRuntimeStillReady()) {
    const cleanupResults = await Promise.allSettled(
      startedEntries.map(({ consumer, token }) =>
        closeAndUnregisterDeferredConsumer(consumer, token)
      )
    );
    const cleanupFailureRoles = cleanupResults.flatMap((result, index) =>
      result.status === 'rejected' ? [startedEntries[index].role] : []
    );
    if (cleanupFailureRoles.length > 0) {
      server.log.error(
        {
          cleanup_failed_roles: cleanupFailureRoles,
          cleanup_failure_codes: cleanupFailureRoles.map(
            () => 'cleanup_failed'
          ),
        },
        'WWebJS: falha ao limpar lote Kafka após indisponibilidade do provider'
      );
      throw new Error(
        `wwebjs_kafka_consumer_batch_cleanup_failed:roles=${cleanupFailureRoles.join(',')}`
      );
    }
    return false;
  }

  for (const { consumer } of startedEntries) {
    try {
      registerWorkerConsumer(consumer);
      deferredConsumersStarting.delete(consumer);
    } catch (error) {
      const cleanupResults = await Promise.allSettled(
        startedEntries.map(({ consumer: startedConsumer, token }) =>
          closeAndUnregisterDeferredConsumer(startedConsumer, token)
        )
      );
      const cleanupFailureRoles = cleanupResults.flatMap((result, index) =>
        result.status === 'rejected' ? [startedEntries[index].role] : []
      );
      server.log.error(
        {
          registration_failed_role:
            deferredConsumerStartupOwnership.get(consumer)?.role ?? 'unknown',
          failure_code: 'registration_failed',
          cleanup_failed_roles: cleanupFailureRoles,
          cleanup_failure_codes: cleanupFailureRoles.map(
            () => 'cleanup_failed'
          ),
        },
        'WWebJS: falha ao registrar lote Kafka após startup'
      );
      if (cleanupFailureRoles.length > 0) {
        throw new Error(
          `wwebjs_kafka_consumer_batch_cleanup_failed:roles=${cleanupFailureRoles.join(',')}`
        );
      }
      throw error;
    }
  }

  return true;
}

let activationPromise: Promise<void> | null = null;
let activationRetryTimer: ReturnType<typeof setTimeout> | undefined;
let activationRetryAttempt = 0;
let activationRetryGeneration = 0;
const WWEBJS_ACTIVATION_RETRY_DELAYS_MS = [
  1_000, 5_000, 15_000, 30_000,
] as const;

async function closeWwebjsRuntimeIngressAfterActivationFailure(
  fastify: FastifyInstance,
  healthCheckService: WwebjsHealthCheckService
): Promise<void> {
  runtimeIngressCleanupRequired = true;
  if (runtimeIngressCleanupPromise) {
    return runtimeIngressCleanupPromise;
  }

  const operation = (async () => {
    providerRuntimeReady = false;
    const cleanupResults = await Promise.allSettled(
      [
        () => healthCheckService.stop(),
        () => container.resolve(WorkerSelfMonitorService).stop(),
        () => emitWorkerProviderRuntimeState('wwebjs', false),
        () => cancelDeferredConsumerStartup(fastify, true),
        () => setKafkaConsumersProviderReady(false, fastify.log),
        () => closeAndDiscardQrStream(fastify),
        () => container.resolve(WwebjsService).shutdown(),
      ].map((cleanup) => Promise.resolve().then(cleanup))
    );
    const cleanupFailureCount = cleanupResults.filter(
      (result) => result.status === 'rejected'
    ).length;
    if (cleanupFailureCount > 0) {
      throw new Error(
        `wwebjs_runtime_activation_cleanup_incomplete:failures=${cleanupFailureCount}`
      );
    }
    runtimeIngressCleanupRequired = false;
  })();
  const tracked = operation.finally(() => {
    if (runtimeIngressCleanupPromise === tracked) {
      runtimeIngressCleanupPromise = null;
    }
  });
  runtimeIngressCleanupPromise = tracked;
  return tracked;
}

function assertWwebjsRuntimeTransitionCurrent(
  generation: number,
  reason: 'bootstrap' | 'resume'
): void {
  if (
    runtimeClosing ||
    databaseSuspended ||
    generation !== runtimeLifecycleGeneration
  ) {
    throw new Error(`wwebjs_runtime_${reason}_cancelled`);
  }
}

function prepareWwebjsRuntime(
  fastify: FastifyInstance,
  options: { resumeExisting: boolean }
): Promise<void> {
  if (runtimeBootstrapTransitionPromise) {
    if (runtimeBootstrapTransitionGeneration === runtimeLifecycleGeneration) {
      return runtimeBootstrapTransitionPromise;
    }
    const staleTransition = runtimeBootstrapTransitionPromise;
    return staleTransition
      .catch(() => undefined)
      .then(() => prepareWwebjsRuntime(fastify, options));
  }

  const generation = runtimeLifecycleGeneration;
  const operation = (async () => {
    const healthCheckService = container.resolve(WwebjsHealthCheckService);
    let preflightCleanupFailed = false;
    try {
      assertWwebjsRuntimeTransitionCurrent(generation, 'bootstrap');
      if (runtimeIngressCleanupRequired) {
        try {
          await closeWwebjsRuntimeIngressAfterActivationFailure(
            fastify,
            healthCheckService
          );
        } catch (error) {
          preflightCleanupFailed = true;
          throw error;
        }
        assertWwebjsRuntimeTransitionCurrent(generation, 'bootstrap');
      }
      const bootstrap = healthCheckService.bootstrapConnection();
      fastify.wwebjsInitialized = bootstrap;
      await bootstrap;
      assertWwebjsRuntimeTransitionCurrent(generation, 'bootstrap');

      if (!runtimeConsumerControlPlaneStarted) {
        await startConsumers(fastify);
        assertWwebjsRuntimeTransitionCurrent(generation, 'bootstrap');
        runtimeConsumerControlPlaneStarted = true;
        return;
      }

      if (options.resumeExisting) {
        await resumeQrStream(fastify);
        assertWwebjsRuntimeTransitionCurrent(generation, 'resume');
        startWorkerSelfMonitor(fastify);
      }
    } catch (error) {
      if (!runtimeConsumerControlPlaneStarted && !preflightCleanupFailed) {
        try {
          await closeWwebjsRuntimeIngressAfterActivationFailure(
            fastify,
            healthCheckService
          );
        } catch (cleanupError) {
          throw cleanupError;
        }
      }
      throw error;
    }
  })();
  const tracked = operation.finally(() => {
    if (runtimeBootstrapTransitionPromise === tracked) {
      runtimeBootstrapTransitionPromise = null;
      runtimeBootstrapTransitionGeneration = null;
    }
  });
  runtimeBootstrapTransitionPromise = tracked;
  runtimeBootstrapTransitionGeneration = generation;
  return tracked;
}

function cancelWwebjsRuntimeActivationRetry(): void {
  activationRetryGeneration += 1;
  activationRetryAttempt = 0;
  if (activationRetryTimer) {
    clearTimeout(activationRetryTimer);
    activationRetryTimer = undefined;
  }
}

function startWwebjsRuntimeActivationWithRetry(fastify: FastifyInstance): void {
  cancelWwebjsRuntimeActivationRetry();
  const generation = activationRetryGeneration;

  const run = (): void => {
    if (
      runtimeClosing ||
      databaseSuspended ||
      generation !== activationRetryGeneration
    ) {
      return;
    }
    void activateWwebjsRuntime(fastify).then(
      () => {
        if (generation === activationRetryGeneration) {
          activationRetryAttempt = 0;
        }
      },
      (error) => {
        if (
          runtimeClosing ||
          databaseSuspended ||
          generation !== activationRetryGeneration
        ) {
          return;
        }
        const retryInMs =
          WWEBJS_ACTIVATION_RETRY_DELAYS_MS[
            Math.min(
              activationRetryAttempt,
              WWEBJS_ACTIVATION_RETRY_DELAYS_MS.length - 1
            )
          ];
        activationRetryAttempt += 1;
        fastify.log.error(
          {
            ...workerErrorDiagnostics(error),
            retry_in_ms: retryInMs,
          },
          'Wwebjs: falha ao ativar runtime; nova tentativa agendada'
        );
        activationRetryTimer = setTimeout(() => {
          activationRetryTimer = undefined;
          run();
        }, retryInMs);
        activationRetryTimer.unref?.();
      }
    );
  };

  run();
}

export async function activateWwebjsRuntime(
  fastify: FastifyInstance
): Promise<{ alreadyActive?: boolean }> {
  const alreadyActive = activationPromise !== null;
  if (!activationPromise) {
    activationPromise = (async () => {
      if (wwebjsEnvironment.isRuntimeActivated) {
        ensureDatabaseAvailabilityGuard(fastify);
      }
      await prepareWwebjsRuntime(fastify, { resumeExisting: false });
    })();
  }

  const attempt = activationPromise;
  try {
    await attempt;
  } catch (error) {
    if (activationPromise === attempt) {
      activationPromise = null;
    }
    throw error;
  }
  return { alreadyActive };
}

const wwebjsConsumersOnListenHook = fp(async (fastify) => {
  const unsubscribeProviderDesiredState =
    subscribeWorkerProviderRuntimeDesiredState('wwebjs', (ready) => {
      if (ready) {
        return;
      }
      void cancelDeferredConsumerStartup(fastify);
      void setKafkaConsumersProviderReady(false, fastify.log).catch((err) => {
        fastify.log.error(
          { err },
          'Wwebjs: falha ao interromper consumidores Kafka imediatamente'
        );
      });
    });
  const unsubscribeProviderState = subscribeWorkerProviderRuntimeState(
    'wwebjs',
    async (ready) => {
      providerRuntimeReady = ready;
      try {
        if (ready) {
          const started = await ensureDeferredConsumersStarted(fastify);
          if (!started || !isProviderRuntimeStillReady()) {
            throw new Error(
              'wwebjs_provider_became_unavailable_during_consumer_startup'
            );
          }
        } else {
          await cancelDeferredConsumerStartup(fastify);
          await setKafkaConsumersProviderReady(false, fastify.log);
        }
      } catch (err) {
        fastify.log.error(
          { err, ready },
          'Wwebjs: falha ao transicionar consumidores Kafka com o provider'
        );
        throw err;
      }
    }
  );

  fastify.addHook('onListen', () => {
    if (wwebjsEnvironment.isWarmStandby) {
      fastify.log.info(
        {
          component: 'wwebjs_consumer_boot',
          type: 'warm_pool.standby',
          warm_pool_id: wwebjsEnvironment.warmPoolId,
        },
        'Wwebjs warm standby: skipping session bootstrap and consumers'
      );
      return;
    }

    ensureDatabaseAvailabilityGuard(fastify);

    startWwebjsRuntimeActivationWithRetry(fastify);
  });

  fastify.addHook('onClose', async () => {
    runtimeClosing = true;
    runtimeLifecycleGeneration += 1;
    cancelWwebjsRuntimeActivationRetry();
    databaseSuspended = true;
    providerRuntimeReady = false;
    databaseAvailabilityGuard?.stop();
    databaseAvailabilityGuard = null;
    unsubscribeSessionLeaseLost?.();
    unsubscribeSessionLeaseLost = null;
    databaseRecoveryFenceEpoch = null;
    unsubscribeProviderDesiredState();
    unsubscribeProviderState();
    const providerStop = setKafkaConsumersProviderReady(false, fastify.log);
    const startupAttempts = [
      qrStreamStartupPromise,
      deferredConsumersPromise,
      activationPromise,
      runtimeBootstrapTransitionPromise,
      runtimeIngressCleanupPromise,
    ].filter(
      (attempt): attempt is Promise<void> | Promise<boolean> => attempt !== null
    );
    await Promise.allSettled([
      providerStop,
      cancelDeferredConsumerStartup(fastify),
      ...startupAttempts,
    ]);
    const residualCleanup = await Promise.allSettled([
      cancelDeferredConsumerStartup(fastify, true),
      closeStartingQrConsumer(),
    ]);
    const wwebjsService = container.resolve(WwebjsService);
    container.resolve(WorkerSelfMonitorService).stop();
    await Promise.allSettled(
      getWorkerConsumers()
        .map((consumer) => consumer?.close?.() ?? Promise.resolve())
        .concat(wwebjsService.shutdown())
    );
    const residualFailures = residualCleanup.filter(
      (result) => result.status === 'rejected'
    ).length;
    if (residualFailures > 0) {
      throw new Error(
        `Wwebjs: falha ao encerrar ${residualFailures} startup(s) de consumidor`
      );
    }
  });
});

export default wwebjsConsumersOnListenHook;
