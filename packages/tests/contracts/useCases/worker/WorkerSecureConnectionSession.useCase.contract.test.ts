import 'reflect-metadata';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import { ISecureConnectionSession } from '@core/common/interfaces/ISecureConnectionSession';
import { IWorkerRuntimeHealthResponseProto } from '@core/common/interfaces/IWorkerRuntimeActivationProto';

const sessionKey = (token: string) => `connection:secure:session:${token}`;

const buildRedis = (store = new Map<string, string>()) => ({
  store,
  client: {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    }),
  },
});

const buildUseCase = (
  overrides: {
    redis?: ReturnType<typeof buildRedis>['client'];
    workerService?: Record<string, jest.Mock>;
    centrifugoService?: Record<string, jest.Mock>;
    workerGrpcClientService?: Record<string, jest.Mock>;
  } = {}
) => {
  const workerService = overrides.workerService ?? {
    updateWorkerPhoneStatusConnectionDate: jest.fn(async () => true),
  };
  const centrifugoService = overrides.centrifugoService ?? {
    publish: jest.fn(async () => ({})),
    publishSub: jest.fn(async () => ({})),
  };
  const workerGrpcClientService = overrides.workerGrpcClientService ?? {
    runtimeHealth: jest.fn(),
  };

  return {
    useCase: new WorkerSecureConnectionSessionUseCase(
      workerService as never,
      (overrides.redis ?? buildRedis().client) as never,
      centrifugoService as never,
      workerGrpcClientService as never,
      {} as never
    ),
    workerService,
    centrifugoService,
    workerGrpcClientService,
  };
};

const buildSession = (workerTypeId: EWorkerType): ISecureConnectionSession => ({
  account_id: 'account-1',
  worker_id: 'worker-1',
  server_id: 'server-1',
  worker_type_id: workerTypeId,
  token: 'token-1',
  token_hash: 'token-hash',
  deep_link: 'underchat-authenticator://secure?token=token-1',
  status: 'validating_worker',
  connection_attempt_id: 'attempt-1',
  runtime_generation: 1,
  created_at: '2099-01-01T00:00:00.000Z',
  updated_at: '2099-01-01T00:00:00.000Z',
  expires_at: '2099-01-01T00:15:00.000Z',
});

const buildReadyHealth = (
  workerTypeId: EWorkerType,
  overrides: Partial<IWorkerRuntimeHealthResponseProto> = {}
): IWorkerRuntimeHealthResponseProto => ({
  worker_id: 'worker-1',
  account_id: 'account-1',
  worker_type_id: workerTypeId,
  runtime_generation: 1,
  runtime_state: 'active',
  activated: true,
  ready: true,
  session_ready: true,
  can_send: true,
  can_receive_runtime: true,
  authenticated: true,
  standby: false,
  has_session: true,
  qr_stream_ready: true,
  provider_state: 'connected',
  phone: '556192037138',
  kafka_unhealthy: false,
  ...overrides,
});

describe('WorkerSecureConnectionSessionUseCase secure import readiness', () => {
  it('accepts Baileys open provider state as ready', () => {
    const { useCase } = buildUseCase();

    const readiness = (
      useCase as unknown as {
        resolveRuntimeHealthReadiness: (
          health: IWorkerRuntimeHealthResponseProto,
          session: ISecureConnectionSession,
          phoneFallback?: string | null
        ) => { hardFailure: boolean; ready: boolean; phone: string | null };
      }
    ).resolveRuntimeHealthReadiness(
      buildReadyHealth(EWorkerType.baileys, { provider_state: 'open' }),
      buildSession(EWorkerType.baileys)
    );

    expect(readiness).toMatchObject({
      hardFailure: false,
      ready: true,
      phone: '556192037138',
    });
  });

  it('keeps transient whatsmeow disconnects retryable during validation', () => {
    const { useCase } = buildUseCase();

    const readiness = (
      useCase as unknown as {
        resolveRuntimeHealthReadiness: (
          health: IWorkerRuntimeHealthResponseProto,
          session: ISecureConnectionSession,
          phoneFallback?: string | null
        ) => {
          hardFailure: boolean;
          ready: boolean;
          reason?: string;
          phone: string | null;
        };
      }
    ).resolveRuntimeHealthReadiness(
      buildReadyHealth(EWorkerType.whatsmeow, {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        provider_state: 'degraded',
        degraded_reason: 'disconnected_event',
      }),
      buildSession(EWorkerType.whatsmeow)
    );

    expect(readiness.hardFailure).toBe(false);
    expect(readiness.ready).toBe(false);
    expect(readiness.phone).toBe('556192037138');
    expect(readiness.reason).toContain('secure_import_runtime_not_ready');
    expect(readiness.reason).toContain('degraded_reason');
  });

  it('still treats terminal runtime invalidation as a hard failure', () => {
    const { useCase } = buildUseCase();

    const readiness = (
      useCase as unknown as {
        resolveRuntimeHealthReadiness: (
          health: IWorkerRuntimeHealthResponseProto,
          session: ISecureConnectionSession,
          phoneFallback?: string | null
        ) => { hardFailure: boolean; ready: boolean };
      }
    ).resolveRuntimeHealthReadiness(
      buildReadyHealth(EWorkerType.whatsmeow, {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        provider_state: 'degraded',
        degraded_reason: 'logged_out',
      }),
      buildSession(EWorkerType.whatsmeow)
    );

    expect(readiness).toMatchObject({
      hardFailure: true,
      ready: false,
    });
  });

  it('recovers validating secure imports when helper reports a network failure after wwebjs connected', async () => {
    const redis = buildRedis();
    const session: ISecureConnectionSession = {
      ...buildSession(EWorkerType.wwebjs),
      upload_received_at: '2026-01-01T00:01:00.000Z',
      imported_at: '2026-01-01T00:01:10.000Z',
    };
    redis.store.set(sessionKey(session.token), JSON.stringify(session));
    const { useCase, workerGrpcClientService, workerService } = buildUseCase({
      redis: redis.client,
      workerGrpcClientService: {
        runtimeHealth: jest.fn(async () =>
          buildReadyHealth(EWorkerType.wwebjs, {
            provider_state: 'CONNECTED',
          })
        ),
      },
    });

    const response = await useCase.updateHelperStatus(
      ((key: string) => key) as never,
      {
        token: session.token,
        status: 'failed',
        error: 'fetch failed',
      }
    );

    expect(response.status).toBe('connected_confirmed');
    expect(response.error).toBeUndefined();
    expect(workerGrpcClientService.runtimeHealth).toHaveBeenCalledWith(
      'server-1',
      { worker_id: 'worker-1' }
    );
    expect(
      workerService.updateWorkerPhoneStatusConnectionDate
    ).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      status: EWorkerStatus.online,
      number: '556192037138',
      connection_date: expect.any(String),
    });
    const savedSession = JSON.parse(
      redis.store.get(sessionKey(session.token)) ?? '{}'
    );
    expect(savedSession).toMatchObject({
      status: 'connected_confirmed',
      phone: '556192037138',
    });
    expect(savedSession.error).toBeUndefined();
    expect(savedSession.fail_reason).toBeUndefined();
  });
});
