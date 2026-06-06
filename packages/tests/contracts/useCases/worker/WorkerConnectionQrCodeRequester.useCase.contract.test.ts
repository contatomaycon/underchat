import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('uuid', () => ({ v7: jest.fn(() => 'uuid-mock') }));

import { WorkerConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerConnectionQrCodeRequester.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';

const t = ((key: string) => {
  const messages: Record<string, string> = {
    worker_not_found: 'Worker not found!',
    worker_qrcode_not_ready: 'Worker not ready!',
    worker_type_invalid: 'Worker type invalid!',
  };
  return messages[key] ?? key;
}) as never;

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ...args: string[]) => {
      if (args.includes('NX') && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
}

function makeUseCase(
  overrides: {
    workerStatusId?: EWorkerStatus;
    workerTypeId?: EWorkerType;
    ready?: boolean;
    redisInitial?: Record<string, string>;
  } = {}
) {
  const workerService = {
    existsWorkerById: jest.fn(async () => true),
    viewWorker: jest.fn(async () => ({
      id: 'worker-1',
      name: 'Worker',
      number: null,
      status: {
        id: overrides.workerStatusId ?? EWorkerStatus.disponible,
        name: 'Disponivel',
      },
      type: { id: overrides.workerTypeId ?? EWorkerType.baileys, name: 'Type' },
      server: { id: 'server-1', name: 'Server' },
      connection_date: null,
      created_at: null,
      updated_at: null,
    })),
  };
  const kafkaBaileysQueueService = {
    workerConnectionQrCode: jest.fn(
      (workerId: string) => `worker.${workerId}.connection.qrcode`
    ),
    ensure: jest.fn(async () => undefined),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => ({})),
  };
  const readinessService = {
    isReady: jest.fn(async () => overrides.ready ?? true),
  };
  const redis = makeRedis(overrides.redisInitial);
  const useCase = new WorkerConnectionQrCodeRequesterUseCase(
    workerService as never,
    kafkaBaileysQueueService as never,
    streamProducerService as never,
    centrifugoService as never,
    readinessService as never,
    redis as never
  );

  return {
    useCase,
    workerService,
    kafkaBaileysQueueService,
    streamProducerService,
    centrifugoService,
    readinessService,
    redis,
  };
}

describe('WorkerConnectionQrCodeRequesterUseCase', () => {
  beforeEach(() => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'false';
  });

  it('enqueues a QR request and returns a pending ack without QR data', async () => {
    const deps = makeUseCase();

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      qr_pending: true,
      reason: 'queued',
    });
    expect(response.qrcode).toBeUndefined();
    expect(response.pairing_code).toBeUndefined();
    expect(response.connection_attempt_id).toBeTruthy();
    expect(response.connection_lifecycle_id).toBeTruthy();

    expect(deps.readinessService.isReady).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
    });
    expect(deps.kafkaBaileysQueueService.ensure).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(deps.streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(deps.streamProducerService.send).toHaveBeenCalledWith(
      'worker.worker-1.connection.qrcode',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: response.connection_attempt_id,
        connection_lifecycle_id: response.connection_lifecycle_id,
        source: 'manager',
      }),
      'worker-1',
      expect.arrayContaining([
        expect.objectContaining({
          'x-connection-lifecycle-id': response.connection_lifecycle_id,
        }),
      ])
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      response
    );
  });

  it('rejects when the worker is not disponible and does not enqueue', async () => {
    const deps = makeUseCase({ workerStatusId: EWorkerStatus.creating });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('Worker not ready!');

    expect(deps.streamProducerService.send).not.toHaveBeenCalled();
  });

  it('returns an active attempt without duplicating the Kafka message', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-1',
        connection_lifecycle_id: 'lifecycle-1',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date().toISOString(),
      topic: 'worker.worker-1.connection.qrcode',
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        'connection:qrcode:worker-1:active_attempt':
          JSON.stringify(activeAttempt),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject(activeAttempt.ack);
    expect(deps.streamProducerService.send).not.toHaveBeenCalled();
  });

  it('returns a cached QR code without duplicating the Kafka message', async () => {
    const cachedQr = {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'attempt-cached',
      connection_lifecycle_id: 'lifecycle-cached',
      qrcode: 'data:image/png;base64,cached',
      qr_generated_at: new Date().toISOString(),
      qr_pending: false,
      reason: 'cached_qr_available',
    };
    const deps = makeUseCase({
      redisInitial: {
        'connection:qrcode:worker-1:attempt': JSON.stringify(cachedQr),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection_attempt_id: 'attempt-cached',
      connection_lifecycle_id: 'lifecycle-cached',
      qrcode: 'data:image/png;base64,cached',
      qr_pending: false,
    });
    expect(deps.streamProducerService.send).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_type_id: EWorkerType.baileys,
        qrcode: 'data:image/png;base64,cached',
        qr_pending: false,
      })
    );
  });

  it('ignores cached QR code from a different worker type', async () => {
    const cachedQr = {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'attempt-baileys-cache',
      connection_lifecycle_id: 'lifecycle-baileys-cache',
      qrcode: 'data:image/png;base64,baileys',
      qr_generated_at: new Date().toISOString(),
      qr_pending: false,
    };
    const deps = makeUseCase({
      workerTypeId: EWorkerType.wwebjs,
      redisInitial: {
        'connection:qrcode:worker-1:attempt': JSON.stringify(cachedQr),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.qrcode).toBeUndefined();
    expect(response.connection_attempt_id).not.toBe('attempt-baileys-cache');
    expect(deps.streamProducerService.send).toHaveBeenCalledWith(
      'worker.worker-1.connection.qrcode',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.wwebjs,
      }),
      'worker-1',
      expect.any(Array)
    );
  });

  it('ignores cached QR code without worker type metadata', async () => {
    const cachedQr = {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'attempt-legacy-cache',
      connection_lifecycle_id: 'lifecycle-legacy-cache',
      qrcode: 'data:image/png;base64,legacy',
      qr_generated_at: new Date().toISOString(),
      qr_pending: false,
    };
    const deps = makeUseCase({
      workerTypeId: EWorkerType.wwebjs,
      redisInitial: {
        'connection:qrcode:worker-1:attempt': JSON.stringify(cachedQr),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.qrcode).toBeUndefined();
    expect(response.connection_attempt_id).not.toBe('attempt-legacy-cache');
    expect(deps.streamProducerService.send).toHaveBeenCalledTimes(1);
  });

  it('does not reuse an already processed active QR attempt', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-processed',
        connection_lifecycle_id: 'lifecycle-processed',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date().toISOString(),
      topic: 'worker.worker-1.connection.qrcode',
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        'connection:qrcode:worker-1:active_attempt':
          JSON.stringify(activeAttempt),
        'connection:qrcode:worker-1:processed:attempt-processed': '1',
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.connection_attempt_id).not.toBe('attempt-processed');
    expect(deps.redis.del).toHaveBeenCalledWith(
      'connection:qrcode:worker-1:active_attempt'
    );
    expect(deps.streamProducerService.send).toHaveBeenCalledTimes(1);
  });

  it('does not reuse an active QR attempt from a previous worker type', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-baileys',
        connection_lifecycle_id: 'lifecycle-baileys',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date().toISOString(),
      topic: 'worker.worker-1.connection.qrcode',
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      workerTypeId: EWorkerType.wwebjs,
      redisInitial: {
        'connection:qrcode:worker-1:active_attempt':
          JSON.stringify(activeAttempt),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.connection_attempt_id).not.toBe('attempt-baileys');
    expect(deps.streamProducerService.send).toHaveBeenCalledWith(
      'worker.worker-1.connection.qrcode',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.wwebjs,
      }),
      'worker-1',
      expect.any(Array)
    );
    expect(deps.redis.del).toHaveBeenCalledWith(
      'connection:qrcode:worker-1:active_attempt'
    );
  });

  it('requeues an old pending active attempt only when a new QR request arrives', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-old',
        connection_lifecycle_id: 'lifecycle-old',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date(Date.now() - 60_000).toISOString(),
      topic: 'worker.worker-1.connection.qrcode',
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        'connection:qrcode:worker-1:active_attempt':
          JSON.stringify(activeAttempt),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      worker_id: 'worker-1',
      account_id: 'account-1',
      qr_pending: true,
      reason: 'queued',
    });
    expect(response.connection_attempt_id).not.toBe('attempt-old');
    expect(deps.redis.del).toHaveBeenCalledWith(
      'connection:qrcode:worker-1:active_attempt'
    );
    expect(deps.streamProducerService.send).toHaveBeenCalledTimes(1);
  });
});
