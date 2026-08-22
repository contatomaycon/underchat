import 'reflect-metadata';

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-baileys',
    baileysWorkerId: 'worker-baileys',
    runtimeGeneration: 11,
  },
}));

jest.mock('@core/consumer/worker/WorkerConnectionStatus.consume', () => ({
  WorkerConnectionStatusConsume: class {},
}));

jest.mock('@core/services/workerConnectionQrCodeRedisQueue.service', () => ({
  WorkerConnectionQrCodeRedisQueueService: class {},
}));

jest.mock('@core/services/connectionLifecycleDebug.service', () => ({
  ConnectionLifecycleDebugService: class {},
}));

import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerConnectionQrCodeConsume } from '@core/consumer/worker/WorkerConnectionQrCode.consume';
import type { WorkerConnectionQrCodeRedisStreamMessage } from '@core/services/workerConnectionQrCodeRedisQueue.service';

const WORKER_ID = 'worker-baileys';
const ACCOUNT_ID = 'account-baileys';
const ATTEMPT_ID = 'attempt-baileys';
const AUTHORIZED_CONNECTION_EPOCH = 'epoch-baileys';
const MISSING_IDENTITY = '__underchat_missing_identity__';

interface MutableConsumerStatics {
  FIRST_QR_SETUP_TIMEOUT_MS: number;
  LOCAL_REQUEST_MAX_ATTEMPTS: number;
  LOCAL_REQUEST_RETRY_DELAY_MS: number;
  STREAM_MAX_DELIVERIES: number;
  STREAM_RETRY_BASE_DELAY_MS: number;
  STREAM_RETRY_MAX_DELAY_MS: number;
}

function transportError(
  code: string,
  secret: string
): Error & { code: string } {
  return Object.assign(new Error(secret), { code });
}

function makeMessage(
  deliveryCount: number,
  requestedAt = '2026-08-09T18:00:00.000Z'
): WorkerConnectionQrCodeRedisStreamMessage {
  return {
    stream_key: `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:requests`,
    stream_id: '1730000000000-0',
    consumer_group: `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:group`,
    consumer_name: 'consumer-baileys',
    reclaimed: deliveryCount > 1,
    delivery_count: deliveryCount,
    payload: {
      request_id: 'request-baileys',
      connection_attempt_id: ATTEMPT_ID,
      worker_id: WORKER_ID,
      account_id: ACCOUNT_ID,
      worker_type_id: EWorkerType.baileys,
      runtime_generation: 11,
      authorized_connection_epoch: AUTHORIZED_CONNECTION_EPOCH,
      debug_trace_id: 'trace-baileys',
      source: 'manager',
      requested_at: requestedAt,
    },
  };
}

function makeSut(connectionError: Error & { code?: string }) {
  const values = new Map<string, string>();
  const activeKey = `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:active_attempt`;
  values.set(
    activeKey,
    JSON.stringify({
      worker_type_id: EWorkerType.baileys,
      runtime_generation: 11,
      authorized_connection_epoch: AUTHORIZED_CONNECTION_EPOCH,
      ack: {
        connection_attempt_id: ATTEMPT_ID,
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 11,
        authorized_connection_epoch: AUTHORIZED_CONNECTION_EPOCH,
      },
    })
  );

  const evaluateAtomicRelease = (
    key: string,
    expectedAttemptId: string,
    expectedAuthorizedEpoch: string,
    expectedWorkerType: string,
    expectedRuntimeGeneration: string,
    missingIdentity: string
  ): number => {
    const raw = values.get(key);
    if (!raw) {
      return 0;
    }
    const envelope = JSON.parse(raw) as {
      worker_type_id?: string | null;
      runtime_generation?: number | string | null;
      authorized_connection_epoch?: string | null;
      ack?: {
        connection_attempt_id?: string | null;
        worker_type_id?: string | null;
        runtime_generation?: number | string | null;
        authorized_connection_epoch?: string | null;
      };
    };
    if (!envelope.ack) {
      return 0;
    }
    const normalize = (value: unknown): string =>
      value === undefined || value === null ? missingIdentity : String(value);
    const activeWorkerType =
      envelope.worker_type_id ?? envelope.ack.worker_type_id;
    const activeRuntimeGeneration =
      envelope.runtime_generation ?? envelope.ack.runtime_generation;
    const activeAuthorizedEpoch =
      envelope.authorized_connection_epoch ??
      envelope.ack.authorized_connection_epoch;
    if (
      normalize(envelope.ack.connection_attempt_id) !== expectedAttemptId ||
      normalize(activeAuthorizedEpoch) !== expectedAuthorizedEpoch ||
      normalize(activeWorkerType) !== expectedWorkerType ||
      normalize(activeRuntimeGeneration) !== expectedRuntimeGeneration
    ) {
      return 0;
    }
    return Number(values.delete(key));
  };

  const redis = {
    status: 'ready',
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    del: jest.fn(async (key: string) => Number(values.delete(key))),
    eval: jest.fn(
      async (
        _script: string,
        keyCount: number,
        key: string,
        expectedAttemptId: string,
        expectedAuthorizedEpoch: string,
        expectedWorkerType: string,
        expectedRuntimeGeneration: string,
        missingIdentity: string
      ) => {
        if (keyCount !== 1) {
          return 0;
        }
        return evaluateAtomicRelease(
          key,
          expectedAttemptId,
          expectedAuthorizedEpoch,
          expectedWorkerType,
          expectedRuntimeGeneration,
          missingIdentity
        );
      }
    ),
  };
  const redisQueueService = {
    processedAttemptKey: jest.fn(
      (workerId: string, workerTypeId: string, attemptId: string) =>
        `connection:qrcode:${workerTypeId}:${workerId}:processed:${attemptId}`
    ),
    markProcessed: jest.fn(async (payload) => {
      values.set(
        `connection:qrcode:${payload.worker_type_id}:${payload.worker_id}:processed:${payload.connection_attempt_id}`,
        '1'
      );
    }),
    ackAndDelete: jest.fn(async () => ({ acked: 1, deleted: 1 })),
  };
  const terminalState = {
    status: EBaileysConnectionStatus.disconnected,
    code: ECodeMessage.connectionClosed,
    worker_id: WORKER_ID,
    account_id: ACCOUNT_ID,
    worker_type_id: EWorkerType.baileys,
    worker_status_id: EWorkerStatus.disponible,
    connection_attempt_id: ATTEMPT_ID,
    runtime_generation: 11,
    authorized_connection_epoch: AUTHORIZED_CONNECTION_EPOCH,
    qr_pending: false,
    attempt: 6,
    max_attempts: 5,
    retryable: true,
    reason: 'baileys_qr_connection_temporarily_unavailable:econnrefused',
  };
  const workerConnectionStatusConsume = {
    requestConnection: jest.fn(async () => {
      throw connectionError;
    }),
    cancelConnectionAttempt: jest.fn(),
    publishQrCodeAttemptFailed: jest.fn(async () => terminalState),
  };
  const debug = {
    log: jest.fn(async () => undefined),
  };

  const sut = new WorkerConnectionQrCodeConsume(
    redisQueueService as never,
    workerConnectionStatusConsume as never,
    redis as never,
    debug as never
  );

  return {
    sut,
    redis,
    redisQueueService,
    workerConnectionStatusConsume,
    debug,
    values,
    activeKey,
    evaluateAtomicRelease,
  };
}

async function handleMessage(
  sut: WorkerConnectionQrCodeConsume,
  message: WorkerConnectionQrCodeRedisStreamMessage
): Promise<void> {
  return (
    sut as unknown as {
      handleMessage(
        value: WorkerConnectionQrCodeRedisStreamMessage
      ): Promise<void>;
    }
  ).handleMessage(message);
}

describe('WorkerConnectionQrCodeConsume bounded stream recovery', () => {
  const statics =
    WorkerConnectionQrCodeConsume as unknown as MutableConsumerStatics;
  const original = {
    FIRST_QR_SETUP_TIMEOUT_MS: statics.FIRST_QR_SETUP_TIMEOUT_MS,
    LOCAL_REQUEST_MAX_ATTEMPTS: statics.LOCAL_REQUEST_MAX_ATTEMPTS,
    LOCAL_REQUEST_RETRY_DELAY_MS: statics.LOCAL_REQUEST_RETRY_DELAY_MS,
    STREAM_MAX_DELIVERIES: statics.STREAM_MAX_DELIVERIES,
    STREAM_RETRY_BASE_DELAY_MS: statics.STREAM_RETRY_BASE_DELAY_MS,
    STREAM_RETRY_MAX_DELAY_MS: statics.STREAM_RETRY_MAX_DELAY_MS,
  };

  beforeEach(() => {
    statics.FIRST_QR_SETUP_TIMEOUT_MS = 120_000;
    statics.LOCAL_REQUEST_MAX_ATTEMPTS = 1;
    statics.LOCAL_REQUEST_RETRY_DELAY_MS = 1;
    statics.STREAM_MAX_DELIVERIES = 5;
    statics.STREAM_RETRY_BASE_DELAY_MS = 1;
    statics.STREAM_RETRY_MAX_DELAY_MS = 8;
  });

  afterAll(() => {
    Object.assign(statics, original);
  });

  it('defers a transient first delivery with backoff and keeps its attempt pending', async () => {
    const error = transportError('ECONNRESET', 'socket reset with secret');
    const { sut, redis, redisQueueService, workerConnectionStatusConsume } =
      makeSut(error);
    const delay = jest.fn(async () => undefined);
    (sut as unknown as { delay(ms: number): Promise<void> }).delay = delay;

    await handleMessage(sut, makeMessage(1));

    expect(delay).toHaveBeenCalledWith(1);
    expect(
      workerConnectionStatusConsume.publishQrCodeAttemptFailed
    ).not.toHaveBeenCalled();
    expect(redisQueueService.markProcessed).not.toHaveBeenCalled();
    expect(redisQueueService.ackAndDelete).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('keeps the current pairing grant pending while the removed runtime fence settles', async () => {
    const { sut, redis, redisQueueService, workerConnectionStatusConsume } =
      makeSut(new Error('worker_runtime_fence_rejected'));
    const delay = jest.fn(async () => undefined);
    (sut as unknown as { delay(ms: number): Promise<void> }).delay = delay;

    await handleMessage(sut, makeMessage(1, new Date().toISOString()));

    expect(delay).toHaveBeenCalledWith(1);
    expect(
      workerConnectionStatusConsume.publishQrCodeAttemptFailed
    ).not.toHaveBeenCalled();
    expect(redisQueueService.markProcessed).not.toHaveBeenCalled();
    expect(redisQueueService.ackAndDelete).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('bounds a runtime fence transition by the first-QR setup deadline', async () => {
    const { sut, redisQueueService, workerConnectionStatusConsume } = makeSut(
      new Error('worker_runtime_fence_rejected')
    );

    await handleMessage(sut, makeMessage(5));

    expect(
      workerConnectionStatusConsume.publishQrCodeAttemptFailed
    ).toHaveBeenCalledTimes(1);
    expect(redisQueueService.markProcessed).toHaveBeenCalledTimes(1);
    expect(redisQueueService.ackAndDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps a recent attempt pending when the provider is still preparing its first QR', async () => {
    const {
      sut,
      redis,
      redisQueueService,
      workerConnectionStatusConsume,
      values,
      activeKey,
    } = makeSut(new Error('unused'));
    workerConnectionStatusConsume.requestConnection.mockResolvedValueOnce({
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      worker_id: WORKER_ID,
      account_id: ACCOUNT_ID,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: ATTEMPT_ID,
      runtime_generation: 11,
      authorized_connection_epoch: AUTHORIZED_CONNECTION_EPOCH,
      qr_pending: true,
      retryable: true,
      reason: 'postgres_session_lease_recovery_pending',
    } as never);

    await handleMessage(sut, makeMessage(1, new Date().toISOString()));

    expect(
      workerConnectionStatusConsume.publishQrCodeAttemptFailed
    ).not.toHaveBeenCalled();
    expect(redisQueueService.markProcessed).not.toHaveBeenCalled();
    expect(redisQueueService.ackAndDelete).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(values.has(activeKey)).toBe(true);
  });

  it('finalizes an exhausted delivery and makes redelivery idempotent', async () => {
    const secret =
      'connect ECONNREFUSED postgresql://runtime:super-secret@db/session';
    const error = transportError('ECONNREFUSED', secret);
    const {
      sut,
      redis,
      redisQueueService,
      workerConnectionStatusConsume,
      debug,
      values,
      activeKey,
    } = makeSut(error);
    const message = makeMessage(193);

    await handleMessage(sut, message);

    expect(
      workerConnectionStatusConsume.requestConnection
    ).toHaveBeenCalledTimes(1);
    expect(
      workerConnectionStatusConsume.publishQrCodeAttemptFailed
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: WORKER_ID,
        connection_attempt_id: ATTEMPT_ID,
        qr_pending: false,
      }),
      expect.objectContaining({
        attempt: 6,
        maxAttempts: 5,
        reason: 'baileys_qr_connection_temporarily_unavailable:econnrefused',
      })
    );
    expect(
      workerConnectionStatusConsume.cancelConnectionAttempt
    ).toHaveBeenCalledTimes(1);
    expect(redisQueueService.markProcessed).toHaveBeenCalledTimes(1);
    expect(redisQueueService.ackAndDelete).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("return redis.call('DEL', KEYS[1])"),
      1,
      activeKey,
      ATTEMPT_ID,
      AUTHORIZED_CONNECTION_EPOCH,
      EWorkerType.baileys,
      '11',
      MISSING_IDENTITY
    );
    const releaseScript = redis.eval.mock.calls[0]?.[0];
    expect(releaseScript).toEqual(
      expect.stringContaining(
        'normalize_identity(active_authorized_epoch) ~= ARGV[2]'
      )
    );
    expect(releaseScript).toEqual(
      expect.stringContaining(
        'normalize_identity(active_worker_type) ~= ARGV[3]'
      )
    );
    expect(releaseScript).toEqual(
      expect.stringContaining(
        'normalize_identity(active_runtime_generation) ~= ARGV[4]'
      )
    );
    expect(values.has(activeKey)).toBe(false);

    await handleMessage(sut, message);

    expect(
      workerConnectionStatusConsume.requestConnection
    ).toHaveBeenCalledTimes(1);
    expect(
      workerConnectionStatusConsume.publishQrCodeAttemptFailed
    ).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(debug.log.mock.calls)).not.toContain(secret);
  });

  it('terminally acknowledges a non-retryable immediate failure', async () => {
    const { sut, redisQueueService, workerConnectionStatusConsume } = makeSut(
      new Error('invalid local QR state with private material') as Error & {
        code?: string;
      }
    );
    const delay = jest.fn(async () => undefined);
    (sut as unknown as { delay(ms: number): Promise<void> }).delay = delay;

    await handleMessage(sut, makeMessage(1));

    expect(delay).not.toHaveBeenCalled();
    expect(
      workerConnectionStatusConsume.publishQrCodeAttemptFailed
    ).toHaveBeenCalledTimes(1);
    expect(redisQueueService.markProcessed).toHaveBeenCalledTimes(1);
    expect(redisQueueService.ackAndDelete).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a returned disconnected no-QR state without reinvoking Baileys', async () => {
    const {
      sut,
      redis,
      redisQueueService,
      workerConnectionStatusConsume,
      values,
      activeKey,
    } = makeSut(new Error('unused'));
    workerConnectionStatusConsume.requestConnection.mockResolvedValueOnce({
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionLost,
      worker_id: WORKER_ID,
      account_id: ACCOUNT_ID,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: ATTEMPT_ID,
      runtime_generation: 11,
      authorized_connection_epoch: AUTHORIZED_CONNECTION_EPOCH,
      qr_pending: false,
      reason: 'connection_closed_before_qr',
    } as never);

    await handleMessage(sut, makeMessage(1));

    expect(
      workerConnectionStatusConsume.requestConnection
    ).toHaveBeenCalledTimes(1);
    expect(
      workerConnectionStatusConsume.publishQrCodeAttemptFailed
    ).not.toHaveBeenCalled();
    expect(redisQueueService.markProcessed).toHaveBeenCalledTimes(1);
    expect(redisQueueService.ackAndDelete).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      activeKey,
      ATTEMPT_ID,
      AUTHORIZED_CONNECTION_EPOCH,
      EWorkerType.baileys,
      '11',
      MISSING_IDENTITY
    );
    expect(values.has(activeKey)).toBe(false);
  });

  it('keeps the terminal delivery pending when failure projection cannot be published', async () => {
    const error = transportError(
      'ECONNREFUSED',
      'provider database unavailable'
    );
    const { sut, redis, redisQueueService, workerConnectionStatusConsume } =
      makeSut(error);
    const projectionError = transportError(
      'ECONNRESET',
      'manager database unavailable'
    );
    workerConnectionStatusConsume.publishQrCodeAttemptFailed.mockRejectedValueOnce(
      projectionError as never
    );
    const delay = jest.fn(async () => undefined);
    (sut as unknown as { delay(ms: number): Promise<void> }).delay = delay;

    await expect(handleMessage(sut, makeMessage(193))).rejects.toBe(
      projectionError
    );

    expect(delay).toHaveBeenCalledWith(8);
    expect(redisQueueService.markProcessed).not.toHaveBeenCalled();
    expect(redisQueueService.ackAndDelete).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(
      workerConnectionStatusConsume.cancelConnectionAttempt
    ).not.toHaveBeenCalled();
  });

  it('does not let a late attempt A delete the replacement attempt B', async () => {
    const { sut, redis, values, activeKey, evaluateAtomicRelease } = makeSut(
      new Error('unused')
    );
    const replacement = JSON.stringify({
      worker_type_id: EWorkerType.baileys,
      runtime_generation: 12,
      authorized_connection_epoch: 'epoch-baileys-b',
      ack: {
        connection_attempt_id: 'attempt-baileys-b',
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 12,
        authorized_connection_epoch: 'epoch-baileys-b',
      },
    });

    redis.get.mockImplementationOnce(async (key: string) => {
      const stale = values.get(key) ?? null;
      values.set(activeKey, replacement);
      return stale;
    });
    redis.eval.mockImplementationOnce(
      async (
        _script: string,
        _keyCount: number,
        key: string,
        expectedAttemptId: string,
        expectedAuthorizedEpoch: string,
        expectedWorkerType: string,
        expectedRuntimeGeneration: string,
        missingIdentity: string
      ) => {
        values.set(activeKey, replacement);
        return evaluateAtomicRelease(
          key,
          expectedAttemptId,
          expectedAuthorizedEpoch,
          expectedWorkerType,
          expectedRuntimeGeneration,
          missingIdentity
        );
      }
    );

    await (
      sut as unknown as {
        releaseActiveAttemptIfCurrent(
          workerId: string,
          attemptId: string,
          authorizedEpoch: string,
          runtimeGeneration: number
        ): Promise<void>;
      }
    ).releaseActiveAttemptIfCurrent(
      WORKER_ID,
      ATTEMPT_ID,
      AUTHORIZED_CONNECTION_EPOCH,
      11
    );

    expect(values.get(activeKey)).toBe(replacement);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('requires the provider type and runtime generation to match', async () => {
    const { sut, redis, values, activeKey } = makeSut(new Error('unused'));
    const mismatchedIdentity = JSON.stringify({
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 12,
      authorized_connection_epoch: AUTHORIZED_CONNECTION_EPOCH,
      ack: {
        connection_attempt_id: ATTEMPT_ID,
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: 12,
        authorized_connection_epoch: AUTHORIZED_CONNECTION_EPOCH,
      },
    });
    values.set(activeKey, mismatchedIdentity);

    await (
      sut as unknown as {
        releaseActiveAttemptIfCurrent(
          workerId: string,
          attemptId: string,
          authorizedEpoch: string,
          runtimeGeneration: number
        ): Promise<void>;
      }
    ).releaseActiveAttemptIfCurrent(
      WORKER_ID,
      ATTEMPT_ID,
      AUTHORIZED_CONNECTION_EPOCH,
      11
    );

    expect(values.get(activeKey)).toBe(mismatchedIdentity);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });
});
