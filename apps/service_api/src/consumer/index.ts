import { FastifyInstance } from 'fastify';
import { startBalanceConsume } from './balance.consume';
import { startMessageUpdateConsume } from './messageUpdate.consume';
import { startMessageUpsertConsume } from './messageUpsert.consume';
import { startMessageHistorySyncConsume } from './messageHistorySync.consume';
import { startMessageStatusUpdateConsume } from './messageStatusUpdate.consume';
import { startChatSummaryClearConsume } from './chatSummaryClear.consume';
import { startPhoneValidationResponseConsume } from './phoneValidationResponse.consume';
import { startProfileStatusExternalIdUpdateConsume } from './profileStatusExternalIdUpdate.consume';
import { startAsaasInvoiceWebhookConsume } from './asaasInvoiceWebhook.consume';
import { startAsaasNfseWebhookConsume } from './asaasNfseWebhook.consume';
import { startNotificationMessageConsume } from './notificationMessage.consume';
import { startOfficialWhatsappMessageSendConsume } from './officialWhatsappMessageSend.consume';
import { startOfficialWhatsappWebhookConsume } from './officialWhatsappWebhook.consume';
import { startUserPhoneJidUpdateConsume } from './userPhoneJidUpdate.consume';
import { startReportConversationHistoryPdfGenerateConsume } from './reportConversationHistoryPdfGenerate.consume';
import { startScheduleStatusUpdateConsume } from './scheduleStatusUpdate.consume';
import { startAiAgentPromptEmbeddingConsume } from './aiAgentPromptEmbedding.consume';
import { startChatHistoryEmbeddingConsume } from './chatHistoryEmbedding.consume';
import { startContactValidationUpdateConsume } from './contactValidationUpdate.consume';
import { startConfigChannelsRecreateAllConsume } from './configChannelsRecreateAll.consume';
import { startBuildVersionGenerateConsume } from './buildVersionGenerate.consume';
import { startBuildVersionCancelConsume } from './buildVersionCancel.consume';
import { startInternalChatDirectMessageConsume } from './internalChatDirectMessage.consume';
import { startInternalChatGroupMessageConsume } from './internalChatGroupMessage.consume';
import { startWorkerWarmReplenishConsume } from './workerWarmReplenish.consume';
import { startWorkerWarmDeleteConsume } from './workerWarmDelete.consume';
import { startWorkerLifecycleConsume } from './workerLifecycle.consume';
import fp from 'fastify-plugin';
import { buildEnvironment } from '@core/config/environments';
import { selectServiceApiConsumerStarters } from '@core/common/functions/selectServiceApiConsumerStarters';
import {
  registerServiceApiConsumer,
  trackServiceApiConsumerStartup,
} from './registry';
import {
  isServiceApiKafkaBootstrapCutoverEnabled,
  resolveServiceApiKafkaCutoverToken,
  ServiceApiKafkaCutoverBarrier,
} from '@core/common/functions/serviceApiKafkaCutoverBarrier';
import { ServiceApiConsumerStartupLifecycle } from './startupLifecycle';
import {
  getConsumerOwnerKafkaHealthSnapshot,
  getConsumerOwnerName,
  type IKafkaConsumerOwnerHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';
import { getErrorMessage } from '@core/common/functions/toError';
import { beginKafkaConsumerGracefulProcessShutdown } from '@core/common/functions/createConsumer';
import { getServiceApiConsumerStartupAttempt } from './startupAttempt';

type ServiceApiConsumer = { close?: () => Promise<void> };
type ServiceApiConsumerStarter = () => ServiceApiConsumer;

interface IServiceApiConsumerStartupSequenceOptions {
  starters: ServiceApiConsumerStarter[];
  isClosing: () => boolean;
  concurrency?: number;
  waitingLogIntervalMs?: number;
  pollIntervalMs?: number;
  consumerStartupTimeoutMs?: number;
  totalStartupTimeoutMs?: number;
  preflightMaxAttempts?: number;
  preflightRetryBaseMs?: number;
  random?: () => number;
  onStarted?: (consumer: ServiceApiConsumer) => void;
  onReady?: (
    consumer: ServiceApiConsumer,
    snapshot: IKafkaConsumerOwnerHealthSnapshot,
    index: number
  ) => void;
  onWaiting?: (
    consumer: ServiceApiConsumer,
    snapshot: IKafkaConsumerOwnerHealthSnapshot | null,
    index: number,
    waitingMs: number
  ) => void;
}

interface IServiceApiConsumerCloseFailure {
  consumer: ServiceApiConsumer;
  owner: string;
  error: unknown;
}

const consumers: ServiceApiConsumer[] = [];

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const CONSUMER_STARTUP_CONCURRENCY = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_STARTUP_CONCURRENCY',
  2
);
const CONSUMER_STARTUP_WAITING_LOG_INTERVAL_MS = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_STARTUP_WAITING_LOG_INTERVAL_MS',
  30000
);
const CONSUMER_STARTUP_POLL_INTERVAL_MS = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_STARTUP_POLL_INTERVAL_MS',
  100
);
const CONSUMER_STARTUP_TIMEOUT_MS = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_CONSUMER_STARTUP_TIMEOUT_MS',
  3 * 60 * 1000
);
const TOTAL_CONSUMER_STARTUP_TIMEOUT_MS = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_STARTUP_TIMEOUT_MS',
  10 * 60 * 1000
);
const CONSUMER_PREFLIGHT_MAX_ATTEMPTS = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_PREFLIGHT_MAX_ATTEMPTS',
  3
);
const CONSUMER_PREFLIGHT_RETRY_BASE_MS = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_PREFLIGHT_RETRY_BASE_MS',
  1_000
);
const CONSUMER_SHUTDOWN_CONCURRENCY = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_SHUTDOWN_CONCURRENCY',
  8
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePreflightRetryDelay(input: {
  attempt: number;
  baseMs: number;
  random: () => number;
}): number {
  const maximumDelayMs = Math.min(
    5_000,
    input.baseMs * 2 ** Math.min(input.attempt - 1, 4)
  );
  const randomValue = input.random();
  const normalizedRandom = Number.isFinite(randomValue)
    ? Math.max(0, Math.min(1, randomValue))
    : 0.5;

  return Math.max(
    1,
    Math.floor(maximumDelayMs * (0.5 + normalizedRandom * 0.5))
  );
}

function closeServiceApiConsumer(consumer: ServiceApiConsumer): Promise<void> {
  return consumer.close?.() ?? Promise.resolve();
}

function resolveConcurrency(value: number, itemCount: number): number {
  if (itemCount === 0) {
    return 0;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(itemCount, Math.floor(value));
}

function isConsumerReady(
  snapshot: IKafkaConsumerOwnerHealthSnapshot | null
): boolean {
  return Boolean(
    snapshot?.connected === true &&
    snapshot.consuming === true &&
    snapshot.assignments_ready === true &&
    snapshot.pod_replacement_required !== true &&
    snapshot.unhealthy !== true
  );
}

function buildProcessReplacementError(
  consumer: ServiceApiConsumer,
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): Error {
  const owner = getConsumerOwnerName(consumer);
  return new Error(
    `Service API Kafka consumer ${owner} requires process replacement (group=${snapshot.group_id || 'unknown'}, last_error=${snapshot.last_error || 'none'})`
  );
}

function buildConsumerStartupTimeoutError(
  consumer: ServiceApiConsumer,
  waitingMs: number
): Error {
  return new Error(
    `Service API Kafka consumer ${getConsumerOwnerName(consumer)} did not become ready within ${waitingMs}ms`
  );
}

async function waitForConsumerReady(input: {
  consumer: ServiceApiConsumer;
  isClosing: () => boolean;
  pollIntervalMs: number;
  waitingLogIntervalMs: number;
  deadlineAt: number;
  readinessTimeoutMs: number;
  preflightMaxAttempts: number;
  preflightRetryBaseMs: number;
  random: () => number;
  onWaiting?: (
    snapshot: IKafkaConsumerOwnerHealthSnapshot | null,
    waitingMs: number
  ) => void;
}): Promise<IKafkaConsumerOwnerHealthSnapshot> {
  const startedAt = Date.now();
  let nextWaitingLogAt = startedAt + input.waitingLogIntervalMs;
  let readinessDeadlineAt: number | null = input.deadlineAt;
  let snapshot = getConsumerOwnerKafkaHealthSnapshot(input.consumer);

  while (true) {
    if (input.isClosing()) {
      throw new Error('Service API consumer startup was cancelled');
    }
    const startupAttempt = getServiceApiConsumerStartupAttempt(input.consumer);
    if (snapshot?.pod_replacement_required === true) {
      throw buildProcessReplacementError(input.consumer, snapshot);
    }
    if (startupAttempt?.state === 'rejected') {
      if (startupAttempt.attempt >= input.preflightMaxAttempts) {
        throw startupAttempt.error;
      }

      const retryDelayMs = resolvePreflightRetryDelay({
        attempt: startupAttempt.attempt,
        baseMs: input.preflightRetryBaseMs,
        random: input.random,
      });
      await delay(retryDelayMs);
      if (input.isClosing()) {
        throw new Error('Service API consumer startup was cancelled');
      }
      readinessDeadlineAt = null;
      void startupAttempt.retry();
      snapshot = getConsumerOwnerKafkaHealthSnapshot(input.consumer);
      continue;
    }
    const now = Date.now();
    if (startupAttempt?.state === 'pending') {
      readinessDeadlineAt = null;
    } else {
      readinessDeadlineAt ??= now + input.readinessTimeoutMs;
      if (snapshot && isConsumerReady(snapshot)) {
        return snapshot;
      }
    }
    if (readinessDeadlineAt !== null && now >= readinessDeadlineAt) {
      throw buildConsumerStartupTimeoutError(
        input.consumer,
        Math.max(0, now - startedAt)
      );
    }
    if (now >= nextWaitingLogAt) {
      input.onWaiting?.(snapshot, now - startedAt);
      nextWaitingLogAt = now + input.waitingLogIntervalMs;
    }
    await delay(input.pollIntervalMs);
    snapshot = getConsumerOwnerKafkaHealthSnapshot(input.consumer);
  }
}

/** Starts native Kafka members through a small number of readiness-gated lanes. */
export async function startServiceApiConsumerSequence(
  options: IServiceApiConsumerStartupSequenceOptions
): Promise<void> {
  const concurrency = resolveConcurrency(
    options.concurrency ?? CONSUMER_STARTUP_CONCURRENCY,
    options.starters.length
  );
  const waitingLogIntervalMs =
    options.waitingLogIntervalMs ?? CONSUMER_STARTUP_WAITING_LOG_INTERVAL_MS;
  const pollIntervalMs =
    options.pollIntervalMs ?? CONSUMER_STARTUP_POLL_INTERVAL_MS;
  const consumerStartupTimeoutMs =
    options.consumerStartupTimeoutMs ?? CONSUMER_STARTUP_TIMEOUT_MS;
  const totalStartupTimeoutMs =
    options.totalStartupTimeoutMs ?? TOTAL_CONSUMER_STARTUP_TIMEOUT_MS;
  const preflightMaxAttempts =
    options.preflightMaxAttempts ?? CONSUMER_PREFLIGHT_MAX_ATTEMPTS;
  const preflightRetryBaseMs =
    options.preflightRetryBaseMs ?? CONSUMER_PREFLIGHT_RETRY_BASE_MS;
  const random = options.random ?? Math.random;
  const totalStartupDeadlineAt = Date.now() + totalStartupTimeoutMs;
  let nextIndex = 0;
  let startupCancelled = false;
  let firstStartupError: unknown;

  const isStartupCancelled = (): boolean =>
    startupCancelled || options.isClosing();

  const startNext = async (): Promise<void> => {
    try {
      while (nextIndex < options.starters.length) {
        if (isStartupCancelled()) {
          throw new Error('Service API consumer startup was cancelled');
        }
        const index = nextIndex;
        nextIndex += 1;
        const consumer = options.starters[index]();
        options.onStarted?.(consumer);
        const consumerStartupDeadlineAt = Math.min(
          totalStartupDeadlineAt,
          Date.now() + consumerStartupTimeoutMs
        );
        const snapshot = await waitForConsumerReady({
          consumer,
          isClosing: isStartupCancelled,
          pollIntervalMs,
          waitingLogIntervalMs,
          deadlineAt: consumerStartupDeadlineAt,
          readinessTimeoutMs: consumerStartupTimeoutMs,
          preflightMaxAttempts,
          preflightRetryBaseMs,
          random,
          onWaiting: (currentSnapshot, waitingMs) =>
            options.onWaiting?.(consumer, currentSnapshot, index, waitingMs),
        });
        options.onReady?.(consumer, snapshot, index);
      }
    } catch (error) {
      if (!startupCancelled) {
        firstStartupError = error;
      }
      startupCancelled = true;
      throw error;
    }
  };

  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, startNext)
  );
  if (results.some((result) => result.status === 'rejected')) {
    throw firstStartupError ?? new Error('Service API consumer startup failed');
  }
}

/** Closes consumers with bounded native librdkafka shutdown pressure. */
export async function closeServiceApiConsumerGroup(
  consumerGroup: ServiceApiConsumer[],
  concurrency = CONSUMER_SHUTDOWN_CONCURRENCY
): Promise<IServiceApiConsumerCloseFailure[]> {
  const failures: Array<IServiceApiConsumerCloseFailure & { index: number }> =
    [];
  let nextIndex = 0;
  const workerCount = resolveConcurrency(concurrency, consumerGroup.length);

  const closeNext = async (): Promise<void> => {
    while (nextIndex < consumerGroup.length) {
      const index = nextIndex;
      nextIndex += 1;
      const consumer = consumerGroup[index];
      try {
        await closeServiceApiConsumer(consumer);
      } catch (error) {
        failures.push({
          consumer,
          owner: getConsumerOwnerName(consumer),
          error,
          index,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, closeNext));
  return failures
    .sort((left, right) => left.index - right.index)
    .map(({ consumer, owner, error }) => ({ consumer, owner, error }));
}

async function closeServiceApiConsumers(
  server: FastifyInstance
): Promise<void> {
  const closingConsumers = consumers.splice(0);
  const failures = await closeServiceApiConsumerGroup(closingConsumers);

  if (failures.length > 0) {
    for (const failure of failures) {
      server.log.error(
        {
          consumer_owner: failure.owner,
          error: getErrorMessage(failure.error),
        },
        'Service API Kafka consumer failed to close cleanly'
      );
    }
    server.log.error(
      {
        failed_consumer_count: failures.length,
        consumer_count: closingConsumers.length,
        shutdown_concurrency: CONSUMER_SHUTDOWN_CONCURRENCY,
      },
      'Service API Kafka shutdown completed with consumer close failures'
    );
  }
}

async function startConsumersInternal(
  server: FastifyInstance,
  isClosing: () => boolean
): Promise<void> {
  const enableBuildConsumers = buildEnvironment.serviceApiEnableBuildConsumers;
  const enableNonBuildConsumers =
    buildEnvironment.serviceApiEnableNonBuildConsumers;
  const bootstrapCutoverEnabled =
    enableNonBuildConsumers && isServiceApiKafkaBootstrapCutoverEnabled();
  const kafkaCutoverToken = resolveServiceApiKafkaCutoverToken({
    token: process.env.SERVICE_API_KAFKA_CUTOVER_TOKEN,
    nodeEnvironment: process.env.NODE_ENV,
    bootstrapCutoverEnabled,
  });

  const nonBuildConsumerStarters = [
    () => startBalanceConsume(server),
    () => startMessageUpdateConsume(server),
    () => startMessageUpsertConsume(server),
    () => startMessageHistorySyncConsume(server),
    () => startMessageStatusUpdateConsume(server),
    () => startChatSummaryClearConsume(server),
    () => startPhoneValidationResponseConsume(server),
    () => startProfileStatusExternalIdUpdateConsume(server),
    () => startAsaasInvoiceWebhookConsume(server),
    () => startAsaasNfseWebhookConsume(server),
    () => startNotificationMessageConsume(server),
    () => startOfficialWhatsappMessageSendConsume(server),
    () => startOfficialWhatsappWebhookConsume(server),
    () => startUserPhoneJidUpdateConsume(server),
    () => startReportConversationHistoryPdfGenerateConsume(server),
    () => startScheduleStatusUpdateConsume(server),
    () => startAiAgentPromptEmbeddingConsume(server),
    () => startChatHistoryEmbeddingConsume(server),
    () => startContactValidationUpdateConsume(server),
    () => startConfigChannelsRecreateAllConsume(server),
    () => startInternalChatDirectMessageConsume(server),
    () => startInternalChatGroupMessageConsume(server),
    () => startWorkerWarmReplenishConsume(server),
    () => startWorkerWarmDeleteConsume(server),
    () => startWorkerLifecycleConsume(server),
  ];
  const buildConsumerStarters = [
    () => startBuildVersionGenerateConsume(server),
    () => startBuildVersionCancelConsume(server),
  ];
  const starters = selectServiceApiConsumerStarters({
    enableBuildConsumers,
    enableNonBuildConsumers,
    buildConsumerStarters,
    nonBuildConsumerStarters,
  });

  if (!enableNonBuildConsumers) {
    server.log.info(
      'Service API: non-build Kafka consumers are disabled by SERVICE_API_ENABLE_NON_BUILD_CONSUMERS=false'
    );
  }

  if (!enableBuildConsumers) {
    server.log.info(
      'Service API: build Kafka consumers are disabled by SERVICE_API_ENABLE_BUILD_CONSUMERS=false'
    );
  }

  if (starters.length === 0) {
    server.log.warn(
      'Service API: all Kafka consumers are disabled by environment flags'
    );
    return;
  }

  if (bootstrapCutoverEnabled && kafkaCutoverToken) {
    await new ServiceApiKafkaCutoverBarrier({
      token: kafkaCutoverToken,
      redis: server.Redis,
      logger: server.log,
      isCancelled: isClosing,
    }).waitUntilReleased();
  }

  server.log.info(
    {
      consumer_count: starters.length,
      startup_concurrency: CONSUMER_STARTUP_CONCURRENCY,
    },
    'Starting Service API Kafka consumers with bounded concurrency'
  );

  try {
    await startServiceApiConsumerSequence({
      starters,
      isClosing,
      onStarted: (consumer) => {
        consumers.push(consumer);
        registerServiceApiConsumer(consumer);
      },
      onReady: (consumer, snapshot, index) => {
        server.log.info(
          {
            consumer_owner: getConsumerOwnerName(consumer),
            consumer_index: index + 1,
            consumer_count: starters.length,
            group_id: snapshot.group_id,
            topics: snapshot.topics,
          },
          'Service API Kafka consumer is ready; starting next consumer'
        );
      },
      onWaiting: (consumer, snapshot, index, waitingMs) => {
        server.log.warn(
          {
            consumer_owner: getConsumerOwnerName(consumer),
            consumer_index: index + 1,
            consumer_count: starters.length,
            group_id: snapshot?.group_id,
            topics: snapshot?.topics,
            connected: snapshot?.connected ?? false,
            consuming: snapshot?.consuming ?? false,
            assignments_ready: snapshot?.assignments_ready ?? false,
            last_error: snapshot?.last_error || 'health_snapshot_missing',
            waiting_ms: waitingMs,
            startup_concurrency: CONSUMER_STARTUP_CONCURRENCY,
          },
          'Service API Kafka consumer is still starting; recovery remains active'
        );
      },
    });
  } catch (err) {
    server.log.error(
      {
        err,
        started_consumer_count: consumers.length,
        consumer_count: starters.length,
      },
      'Erro ao iniciar consumidores Kafka'
    );
    throw err;
  }
}

export async function startConsumers(
  server: FastifyInstance,
  isClosing: () => boolean = () => false
): Promise<void> {
  await trackServiceApiConsumerStartup(() =>
    startConsumersInternal(server, isClosing)
  );
}

const serviceApiConsumersOnListenHook = fp(async (fastify) => {
  const lifecycle = new ServiceApiConsumerStartupLifecycle({
    onStartupError: (err) => {
      fastify.log.error({ err }, 'Service API: falha ao iniciar consumidores');
    },
  });

  fastify.addHook('onListen', () => {
    lifecycle.start(() => startConsumers(fastify, lifecycle.isClosing));
  });

  fastify.addHook('onClose', async () => {
    beginKafkaConsumerGracefulProcessShutdown();
    await lifecycle.shutdown(() => closeServiceApiConsumers(fastify));
  });
});

export default serviceApiConsumersOnListenHook;
