import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: jest.fn(() => 'uuid-mock') }));

import { WorkerConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerConnectionQrCodeRequester.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { IWorkerConnectionQrCodeQueueMessage } from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';
import { IWorkerRuntime } from '@core/common/interfaces/IWorkerRuntime';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';

const t = ((key: string) => {
  const messages: Record<string, string> = {
    worker_not_found: 'Worker not found!',
    worker_qrcode_not_ready: 'Worker not ready!',
    worker_type_invalid: 'Worker type invalid!',
  };
  return messages[key] ?? key;
}) as never;
const pairingReadyObservedAt = '2026-08-10T21:00:00.000Z';
const pairingGranted = {
  status: 'granted' as const,
  already_granted: false,
  worker_status_id: EWorkerStatus.disponible,
  worker_status_observed_at: pairingReadyObservedAt,
};

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(
      async (
        key: string,
        value: string,
        _ex?: string,
        _ttl?: number,
        nx?: string
      ) => {
        if (nx === 'NX' && store.has(key)) {
          return null;
        }
        store.set(key, value);
        return 'OK';
      }
    ),
    del: jest.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
    eval: jest.fn(
      async (
        script: string,
        _keyCount: number,
        key: string,
        ...args: string[]
      ) => {
        const raw = store.get(key);
        if (script.includes('qr_active_attempt_compare_raw_delete_v1')) {
          if (raw !== undefined && raw === args[0]) {
            store.delete(key);
            return 1;
          }
          return 0;
        }
        if (!raw) {
          return 0;
        }
        let parsed: {
          ack?: {
            connection_attempt_id?: string;
            event_type?: string;
            worker_status_id?: string;
            worker_status_observed_at?: string;
            disconnected_user?: boolean;
          };
          stream_id?: string;
        };
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          return 0;
        }
        if (parsed.ack?.connection_attempt_id !== args[0]) {
          return 0;
        }
        if (script.includes('qr_active_attempt_compare_stream_v1')) {
          parsed.stream_id = args[1];
          store.set(key, JSON.stringify(parsed));
          return 1;
        }
        if (script.includes('qr_active_attempt_compare_pairing_ready_v1')) {
          if (!parsed.ack) return 0;
          parsed.ack.event_type = 'status';
          parsed.ack.worker_status_id = args[1];
          parsed.ack.worker_status_observed_at = args[2];
          parsed.ack.disconnected_user = false;
          store.set(key, JSON.stringify(parsed));
          return 1;
        }
        if (script.includes('qr_active_attempt_compare_delete_v1')) {
          store.delete(key);
          return 1;
        }
        return 0;
      }
    ),
  };
}

function makeUseCase(
  overrides: {
    workerStatusId?: EWorkerStatus;
    workerTypeId?: EWorkerType | string;
    redisInitial?: Record<string, string>;
    enqueueError?: Error;
    runtimeGeneration?: number;
    runtime?: IWorkerRuntime | null;
    finalizeDisconnectResult?: { status: string };
    pairingGrantResult?: { status: string; already_granted?: boolean };
    runtimeHealth?: Record<string, unknown> | Error;
    connectionStatus?: IWhatsappConnectionStatus | null;
    connectionOnlineAcknowledged?: boolean;
  } = {}
) {
  const workerTypeId = overrides.workerTypeId ?? EWorkerType.baileys;
  const workerStatusId = overrides.workerStatusId ?? EWorkerStatus.disponible;
  const workerService = {
    existsWorkerById: jest.fn(async () => true),
    viewWorker: jest.fn(async () => ({
      id: 'worker-1',
      name: 'Worker',
      number: null,
      status: {
        id: workerStatusId,
        name: 'Disponivel',
      },
      type: { id: workerTypeId, name: 'Type' },
      server: { id: 'server-1', name: 'Server' },
      connection_date: null,
      created_at: null,
      updated_at: pairingReadyObservedAt,
      worker_status_observed_at: pairingReadyObservedAt,
      connection_status: overrides.connectionStatus ?? null,
      connection_online_acknowledged:
        overrides.connectionOnlineAcknowledged ?? false,
    })),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => ({})),
  };
  const redis = makeRedis(overrides.redisInitial);
  const runtime =
    overrides.runtime !== undefined
      ? overrides.runtime
      : overrides.runtimeGeneration
        ? ({
            worker_id: 'worker-1',
            container_id: 'container-1',
            session_storage: EWorkerSessionStorage.postgres,
            session_volume_name: 'worker-1',
            runtime_generation: overrides.runtimeGeneration,
            connection_sequence: 0,
          } satisfies IWorkerRuntime)
        : null;
  const workerRuntimeRepository = runtime
    ? {
        viewByWorkerIdConsistent: jest.fn(async () => runtime),
        finalizeWorkerConnectionDisconnect: jest.fn(
          async () =>
            overrides.finalizeDisconnectResult ?? { status: 'completed' }
        ),
        prepareWorkerConnectionPairingActivation: jest.fn(
          async () => overrides.pairingGrantResult ?? pairingGranted
        ),
        hasCurrentWorkerConnectionPairingAuthorization: jest.fn(
          async () => true
        ),
        revokeWorkerConnectionPairingActivation: jest.fn(async () => true),
      }
    : undefined;
  const redisQueueService = {
    streamKey: jest.fn((workerId: string, workerTypeId: string) => {
      return `connection:qrcode:${workerTypeId}:${workerId}:requests`;
    }),
    consumerGroup: jest.fn((workerId: string, workerTypeId: string) => {
      return `connection:qrcode:${workerTypeId}:${workerId}:group`;
    }),
    enqueue: jest.fn(async (_payload: IWorkerConnectionQrCodeQueueMessage) => {
      if (overrides.enqueueError) {
        throw overrides.enqueueError;
      }
      return '1710000000000-0';
    }),
  };
  const workerGrpcClientService = {
    runtimeHealth: jest.fn(async () => {
      if (overrides.runtimeHealth instanceof Error) {
        throw overrides.runtimeHealth;
      }
      return (
        overrides.runtimeHealth ?? {
          worker_id: 'worker-1',
          account_id: 'account-1',
          worker_type_id: workerTypeId,
          runtime_generation: runtime?.runtime_generation,
          activated: true,
          standby: false,
        }
      );
    }),
  };

  const useCase = new WorkerConnectionQrCodeRequesterUseCase(
    workerService as never,
    centrifugoService as never,
    redis as never,
    redisQueueService as never,
    workerRuntimeRepository as never,
    workerGrpcClientService as never
  );

  return {
    useCase,
    workerService,
    centrifugoService,
    redis,
    redisQueueService,
    workerRuntimeRepository,
    workerGrpcClientService,
  };
}

describe('WorkerConnectionQrCodeRequesterUseCase', () => {
  it('enqueues a QR request in Redis Streams and publishes pending state', async () => {
    const deps = makeUseCase();

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'uuid-mock',
      qr_pending: true,
      reason: 'queued',
    });
    expect(response.qrcode).toBeUndefined();
    expect(response.pairing_code).toBeUndefined();

    expect(deps.redisQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'uuid-mock',
        connection_attempt_id: response.connection_attempt_id,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        source: 'manager',
        requested_at: expect.any(String),
      })
    );
    expect(deps.redis.set).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`,
      expect.stringContaining(
        `"stream_key":"connection:qrcode:${EWorkerType.baileys}:worker-1:requests"`
      ),
      'EX',
      expect.any(Number),
      'NX'
    );
    expect(
      deps.redis.store.get(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      )
    ).toContain('"stream_id":"1710000000000-0"');
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      response
    );
  });

  it('waits for lifecycle completion before creating an attempt-bound QR request', async () => {
    const deps = makeUseCase({ workerStatusId: EWorkerStatus.creating });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('Worker not ready!');

    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('waits for recreation completion before creating a new QR attempt', async () => {
    const deps = makeUseCase({ workerStatusId: EWorkerStatus.recreating });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('Worker not ready!');

    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a stale QR request after the canonical session is online', async () => {
    const deps = makeUseCase({
      workerStatusId: EWorkerStatus.disponible,
      connectionOnlineAcknowledged: true,
      connectionStatus: {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.online,
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: false,
        qrAvailable: false,
        sequence: 7,
        changedAt: '2026-08-20T16:30:00.000Z',
      },
    });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('Worker not ready!');

    expect(deps.redis.set).not.toHaveBeenCalled();
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('includes runtime generation in the pending response, active attempt and stream payload', async () => {
    const deps = makeUseCase({ runtimeGeneration: 3 });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.runtime_generation).toBe(3);
    expect(
      deps.workerRuntimeRepository?.viewByWorkerIdConsistent
    ).toHaveBeenCalledWith('worker-1');
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 3,
        expires_at: expect.any(String),
      })
    );

    const activeAttempt = JSON.parse(
      deps.redis.store.get(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      ) ?? '{}'
    );
    expect(activeAttempt).toMatchObject({
      runtime_generation: 3,
      ack: expect.objectContaining({
        runtime_generation: 3,
      }),
    });
  });

  it('claims Redis ownership before preparing the durable grant and enqueues only after the grant', async () => {
    const deps = makeUseCase({ runtimeGeneration: 3 });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    const claimOrder = deps.redis.set.mock.invocationCallOrder[0];
    const grantOrder =
      deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
        .mock.invocationCallOrder[0];
    const enqueueOrder =
      deps.redisQueueService.enqueue.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(grantOrder as number);
    expect(grantOrder).toBeLessThan(enqueueOrder);
    expect(response.authorized_connection_epoch).toBe('uuid-mock');
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_attempt_id: 'uuid-mock',
        authorized_connection_epoch: 'uuid-mock',
      })
    );
  });

  it('coalesces concurrent requests while the first durable grant is still being prepared', async () => {
    const deps = makeUseCase({ runtimeGeneration: 3 });
    let releaseGrant!: () => void;
    const grantGate = new Promise<void>((resolve) => {
      releaseGrant = resolve;
    });
    deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation.mockImplementation(
      async () => {
        await grantGate;
        return pairingGranted;
      }
    );

    const first = deps.useCase.execute(t, 'account-1', 'worker-1');
    while (
      !deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
        .mock.calls.length
    ) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const second = deps.useCase.execute(t, 'account-1', 'worker-1');
    releaseGrant();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(secondResponse.connection_attempt_id).toBe(
      firstResponse.connection_attempt_id
    );
    expect(secondResponse).toMatchObject({
      qr_pending: true,
      reason: 'queued',
      runtime_generation: 3,
    });
    expect(
      deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
    ).toHaveBeenCalledTimes(1);
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(
      deps.redis.store.get(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      )
    ).toContain('"stream_id":"1710000000000-0"');
  });

  it('lets a concurrent requester recover when the first setup loses its durable grant', async () => {
    const deps = makeUseCase({ runtimeGeneration: 3 });
    let releaseFirstGrant!: () => void;
    const firstGrantGate = new Promise<void>((resolve) => {
      releaseFirstGrant = resolve;
    });
    deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
      .mockImplementationOnce(async () => {
        await firstGrantGate;
        return { status: 'runtime_mismatch' };
      })
      .mockResolvedValueOnce(pairingGranted);

    const first = deps.useCase.execute(t, 'account-1', 'worker-1');
    while (
      !deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
        .mock.calls.length
    ) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const second = deps.useCase.execute(t, 'account-1', 'worker-1');
    releaseFirstGrant();

    await expect(first).rejects.toThrow('Worker not ready!');
    const recovered = await second;

    expect(recovered).toMatchObject({
      qr_pending: true,
      reason: 'queued',
      runtime_generation: 3,
    });
    expect(
      deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
    ).toHaveBeenCalledTimes(2);
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(
      deps.redis.store.get(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      )
    ).toContain('"stream_id":"1710000000000-0"');
  });

  it('releases Redis ownership and does not enqueue when the durable grant is rejected', async () => {
    const deps = makeUseCase({
      runtimeGeneration: 3,
      pairingGrantResult: { status: 'runtime_mismatch' },
    });
    const activeAttemptKey = `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`;

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('Worker not ready!');

    expect(deps.redis.store.has(activeAttemptKey)).toBe(false);
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
    expect(
      deps.workerRuntimeRepository?.revokeWorkerConnectionPairingActivation
    ).not.toHaveBeenCalled();
  });

  it.each([
    EWorkerStatus.offline,
    EWorkerStatus.mismatched,
    EWorkerStatus.error,
  ])(
    'does not enqueue reconnectable status %s without a reusable runtime',
    async (workerStatusId) => {
      const deps = makeUseCase({ workerStatusId });

      await expect(
        deps.useCase.execute(t, 'account-1', 'worker-1')
      ).rejects.toThrow('Worker not ready!');

      expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
    }
  );

  it.each([EWorkerStatus.offline, EWorkerStatus.mismatched])(
    'reuses the current runtime to request QR from reconnectable status %s',
    async (workerStatusId) => {
      const deps = makeUseCase({
        workerStatusId,
        runtimeGeneration: 4,
      });

      const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

      expect(response).toMatchObject({
        event_type: 'status',
        worker_status_id: EWorkerStatus.disponible,
        worker_status_observed_at: pairingReadyObservedAt,
        runtime_generation: 4,
        connection_attempt_id: 'uuid-mock',
        qr_pending: true,
        reason: 'queued',
      });
      expect(deps.redisQueueService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_id: 'worker-1',
          runtime_generation: 4,
        })
      );
      expect(
        deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          verified_running_container_id: 'container-1',
        })
      );
    }
  );

  it.each([EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow])(
    'physically verifies an available %s runtime so a missing worker pointer can be repaired',
    async (workerTypeId) => {
      const deps = makeUseCase({
        workerStatusId: EWorkerStatus.disponible,
        workerTypeId,
        runtimeGeneration: 4,
      });

      await expect(
        deps.useCase.execute(t, 'account-1', 'worker-1')
      ).resolves.toEqual(
        expect.objectContaining({
          worker_status_id: EWorkerStatus.disponible,
          qr_pending: true,
        })
      );
      expect(
        deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          verified_running_container_id: 'container-1',
        })
      );
    }
  );

  it('fails closed when remote health belongs to another runtime generation', async () => {
    const deps = makeUseCase({
      workerStatusId: EWorkerStatus.mismatched,
      runtimeGeneration: 4,
      runtimeHealth: {
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 3,
        activated: true,
      },
      pairingGrantResult: { status: 'terminal_state_invalid' },
    });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('Worker not ready!');

    expect(
      deps.workerRuntimeRepository?.prepareWorkerConnectionPairingActivation
    ).toHaveBeenCalledWith(
      expect.objectContaining({ verified_running_container_id: undefined })
    );
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('finalizes an exact disconnect tombstone before requesting QR on the same runtime', async () => {
    const runtime = {
      worker_id: 'worker-1',
      container_id: 'container-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: 'worker-1',
      runtime_generation: 5,
      connection_epoch: 'connection-epoch-1',
      disconnected_connection_epoch: 'connection-epoch-1',
      connection_disconnected_at: '2026-08-09T20:00:00.000Z',
      connection_sequence: 11,
    } satisfies IWorkerRuntime;
    const deps = makeUseCase({
      workerStatusId: EWorkerStatus.offline,
      runtime,
      finalizeDisconnectResult: { status: 'completed' },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(
      deps.workerRuntimeRepository?.finalizeWorkerConnectionDisconnect
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      account_id: 'account-1',
      expected_runtime_generation: 5,
      expected_container_id: 'container-1',
      expected_connection_epoch: 'connection-epoch-1',
    });
    expect(response).toMatchObject({
      worker_status_id: EWorkerStatus.disponible,
      runtime_generation: 5,
      qr_pending: true,
      reason: 'queued',
    });
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('fails closed when an exact disconnect tombstone cannot be finalized', async () => {
    const runtime = {
      worker_id: 'worker-1',
      container_id: 'container-1',
      session_storage: EWorkerSessionStorage.postgres,
      session_volume_name: 'worker-1',
      runtime_generation: 5,
      connection_epoch: 'connection-epoch-1',
      disconnected_connection_epoch: 'connection-epoch-1',
      connection_disconnected_at: '2026-08-09T20:00:00.000Z',
      connection_sequence: 11,
    } satisfies IWorkerRuntime;
    const deps = makeUseCase({
      workerStatusId: EWorkerStatus.offline,
      runtime,
      finalizeDisconnectResult: { status: 'session_not_empty' },
    });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('Worker not ready!');

    expect(
      deps.workerRuntimeRepository?.finalizeWorkerConnectionDisconnect
    ).toHaveBeenCalledTimes(1);
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('returns an active attempt without duplicating the Redis stream message', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.disponible,
        connection_attempt_id: 'attempt-1',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date().toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      stream_id: '1710000000000-0',
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      ...activeAttempt.ack,
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
    });
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        connection_attempt_id: 'attempt-1',
        qr_pending: true,
      })
    );
  });

  it('does not regress a pairing-ready active attempt to a stale offline read', async () => {
    const activeAttempt = {
      ack: {
        event_type: 'status',
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.disponible,
        worker_status_observed_at: pairingReadyObservedAt,
        connection_attempt_id: 'attempt-pairing-ready',
        authorized_connection_epoch: 'epoch-pairing-ready',
        runtime_generation: 4,
        qr_pending: true,
        reason: 'queued',
      },
      authorized_connection_epoch: 'epoch-pairing-ready',
      queued_at: new Date().toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      stream_id: '1710000000000-0',
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
      runtime_generation: 4,
    };
    const deps = makeUseCase({
      workerStatusId: EWorkerStatus.offline,
      runtimeGeneration: 4,
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      event_type: 'status',
      worker_status_id: EWorkerStatus.disponible,
      worker_status_observed_at: pairingReadyObservedAt,
      disconnected_user: false,
      connection_attempt_id: 'attempt-pairing-ready',
      qr_pending: true,
    });
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('returns a cached QR code from the matching active attempt without duplicating the Redis stream message', async () => {
    const cachedQr = {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'attempt-cached',
      qrcode: 'data:image/png;base64,cached',
      qr_generated_at: new Date().toISOString(),
      qr_pending: false,
      reason: 'cached_qr_available',
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify({
            ack: {
              ...cachedQr,
              qrcode: undefined,
              qr_generated_at: undefined,
              qr_pending: true,
            },
            queued_at: new Date().toISOString(),
            stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
            stream_id: '1710000000000-0',
            consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
            source: 'manager',
            worker_type_id: EWorkerType.baileys,
          }),
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:attempt`]:
          JSON.stringify(cachedQr),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection_attempt_id: 'attempt-cached',
      qrcode: 'data:image/png;base64,cached',
      qr_pending: false,
    });
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_type_id: EWorkerType.baileys,
        qrcode: 'data:image/png;base64,cached',
        qr_pending: false,
      })
    );
  });

  it('does not reuse a cached QR after its active attempt has ended', async () => {
    const cacheKey = `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`;
    const deps = makeUseCase({
      workerTypeId: EWorkerType.wwebjs,
      redisInitial: {
        [cacheKey]: JSON.stringify({
          code: ECodeMessage.awaitingReadQrCode,
          status: EBaileysConnectionStatus.connecting,
          worker_id: 'worker-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: 'attempt-expired',
          qrcode: 'data:image/png;base64,expired-fifth-qr',
          qr_generated_at: new Date().toISOString(),
          qr_pending: false,
        }),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toEqual(
      expect.objectContaining({
        connection_attempt_id: 'uuid-mock',
        qr_pending: true,
        reason: 'queued',
      })
    );
    expect(response.qrcode).toBeUndefined();
    expect(deps.redis.store.has(cacheKey)).toBe(false);
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not attach a cached QR from an ended attempt to the current attempt', async () => {
    const activeAttemptKey = `connection:qrcode:${EWorkerType.wwebjs}:worker-1:active_attempt`;
    const cacheKey = `connection:qrcode:${EWorkerType.wwebjs}:worker-1:attempt`;
    const deps = makeUseCase({
      workerTypeId: EWorkerType.wwebjs,
      redisInitial: {
        [activeAttemptKey]: JSON.stringify({
          ack: {
            code: ECodeMessage.awaitingReadQrCode,
            status: EBaileysConnectionStatus.connecting,
            worker_id: 'worker-1',
            account_id: 'account-1',
            worker_type_id: EWorkerType.wwebjs,
            worker_status_id: EWorkerStatus.disponible,
            connection_attempt_id: 'attempt-current',
            qr_pending: true,
            reason: 'queued',
          },
          queued_at: new Date().toISOString(),
          stream_key: `connection:qrcode:${EWorkerType.wwebjs}:worker-1:requests`,
          stream_id: '1710000000000-1',
          consumer_group: `connection:qrcode:${EWorkerType.wwebjs}:worker-1:group`,
          source: 'manager',
          worker_type_id: EWorkerType.wwebjs,
        }),
        [cacheKey]: JSON.stringify({
          code: ECodeMessage.awaitingReadQrCode,
          status: EBaileysConnectionStatus.connecting,
          worker_id: 'worker-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.wwebjs,
          worker_status_id: EWorkerStatus.disponible,
          connection_attempt_id: 'attempt-ended',
          qrcode: 'data:image/png;base64,expired-fifth-qr',
          qr_generated_at: new Date().toISOString(),
          qr_pending: false,
        }),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toEqual(
      expect.objectContaining({
        connection_attempt_id: 'attempt-current',
        qr_pending: true,
        reason: 'queued',
      })
    );
    expect(response.qrcode).toBeUndefined();
    expect(deps.redis.store.has(cacheKey)).toBe(false);
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('keeps a processed active attempt while its cached QR can still be renewed', async () => {
    const activeAttemptKey = `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`;
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: 'attempt-renewable',
        qr_pending: false,
      },
      queued_at: new Date().toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      stream_id: '1710000000000-0',
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const cachedQr = {
      ...activeAttempt.ack,
      qrcode: 'data:image/png;base64,renewable',
      qr_generated_at: new Date().toISOString(),
    };
    const deps = makeUseCase({
      redisInitial: {
        [activeAttemptKey]: JSON.stringify(activeAttempt),
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:processed:attempt-renewable`]:
          '1',
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:attempt`]:
          JSON.stringify(cachedQr),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toEqual(
      expect.objectContaining({
        connection_attempt_id: 'attempt-renewable',
        qrcode: 'data:image/png;base64,renewable',
        qr_pending: false,
      })
    );
    expect(deps.redis.store.has(activeAttemptKey)).toBe(true);
    expect(deps.redis.del).not.toHaveBeenCalledWith(activeAttemptKey);
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('returns a cached passkey request without duplicating the Redis stream message', async () => {
    const cachedPasskey = {
      code: ECodeMessage.awaitingPasskey,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.whatsmeow,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'attempt-passkey',
      passkey_public_key: '{"challenge":"abc"}',
      passkey_pending: true,
      qr_pending: false,
      reason: 'cached_passkey_available',
    };
    const deps = makeUseCase({
      workerTypeId: EWorkerType.whatsmeow,
      redisInitial: {
        [`connection:qrcode:${EWorkerType.whatsmeow}:worker-1:active_attempt`]:
          JSON.stringify({
            ack: {
              ...cachedPasskey,
              passkey_public_key: undefined,
              passkey_pending: true,
            },
            queued_at: new Date().toISOString(),
            stream_key: `connection:qrcode:${EWorkerType.whatsmeow}:worker-1:requests`,
            stream_id: '1710000000000-0',
            consumer_group: `connection:qrcode:${EWorkerType.whatsmeow}:worker-1:group`,
            source: 'manager',
            worker_type_id: EWorkerType.whatsmeow,
          }),
        [`connection:qrcode:${EWorkerType.whatsmeow}:worker-1:attempt`]:
          JSON.stringify(cachedPasskey),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      code: ECodeMessage.awaitingPasskey,
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection_attempt_id: 'attempt-passkey',
      passkey_public_key: '{"challenge":"abc"}',
      passkey_pending: true,
      qr_pending: false,
    });
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_type_id: EWorkerType.whatsmeow,
        passkey_public_key: '{"challenge":"abc"}',
        qr_pending: false,
      })
    );
  });

  it('does not reuse cached QR from a previous worker type', async () => {
    const cachedQr = {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: 'attempt-baileys-cache',
      qrcode: 'data:image/png;base64,baileys',
      qr_generated_at: new Date().toISOString(),
      qr_pending: false,
    };
    const deps = makeUseCase({
      workerTypeId: EWorkerType.wwebjs,
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:attempt`]:
          JSON.stringify(cachedQr),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.qrcode).toBeUndefined();
    expect(response.worker_type_id).toBe(EWorkerType.wwebjs);
    expect(response.connection_attempt_id).not.toBe('attempt-baileys-cache');
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('keeps a recently processed attempt while its first QR is being published', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-processed',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date().toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      stream_id: '1710000000000-0',
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:processed:attempt-processed`]:
          '1',
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toEqual(
      expect.objectContaining({
        connection_attempt_id: 'attempt-processed',
        qr_pending: true,
        reason: 'queued',
      })
    );
    expect(
      deps.redis.store.has(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      )
    ).toBe(true);
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('requeues a processed attempt that exceeded the QR publication grace', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-processed-old',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date(Date.now() - 16_000).toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      stream_id: '1710000000000-0',
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:processed:attempt-processed-old`]:
          '1',
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.connection_attempt_id).toBe('uuid-mock');
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('keeps the active attempt after the QR was consumed instead of starting another QR', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.baileys,
        connection_attempt_id: 'attempt-pairing',
        authorized_connection_epoch: 'epoch-pairing',
        runtime_generation: 7,
        qr_pending: true,
      },
      authorized_connection_epoch: 'epoch-pairing',
      runtime_generation: 7,
      queued_at: new Date().toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      stream_id: '1710000000000-0',
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      workerStatusId: EWorkerStatus.connecting,
      runtimeGeneration: 7,
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:processed:attempt-pairing`]:
          '1',
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response).toMatchObject({
      connection_attempt_id: 'attempt-pairing',
      worker_status_id: EWorkerStatus.connecting,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.pairingInProgress,
      qr_pending: false,
      reason: 'pairing_in_progress',
    });
    expect(response.qrcode).toBeUndefined();
    expect(deps.redisQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('does not reuse an old pending active QR attempt without a QR', async () => {
    const activeAttempt = {
      ack: {
        code: ECodeMessage.awaitingReadQrCode,
        status: EBaileysConnectionStatus.connecting,
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-old',
        qr_pending: true,
        reason: 'queued',
      },
      queued_at: new Date(Date.now() - 181_000).toISOString(),
      stream_key: `connection:qrcode:${EWorkerType.baileys}:worker-1:requests`,
      stream_id: '1710000000000-0',
      consumer_group: `connection:qrcode:${EWorkerType.baileys}:worker-1:group`,
      source: 'manager',
      worker_type_id: EWorkerType.baileys,
    };
    const deps = makeUseCase({
      redisInitial: {
        [`connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`]:
          JSON.stringify(activeAttempt),
      },
    });

    const response = await deps.useCase.execute(t, 'account-1', 'worker-1');

    expect(response.connection_attempt_id).not.toBe('attempt-old');
    expect(
      deps.redis.store.has(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      )
    ).toBe(true);
    expect(deps.redisQueueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('clears active attempt when Redis Stream enqueue fails', async () => {
    const deps = makeUseCase({
      enqueueError: new Error('xadd failed'),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', 'worker-1')
    ).rejects.toThrow('xadd failed');

    expect(
      deps.redis.store.has(
        `connection:qrcode:${EWorkerType.baileys}:worker-1:active_attempt`
      )
    ).toBe(false);
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });
});
