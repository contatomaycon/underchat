import 'reflect-metadata';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import { ISecureConnectionSession } from '@core/common/interfaces/ISecureConnectionSession';
import { IWorkerRuntimeHealthResponseProto } from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

const sessionKey = (token: string) => `connection:secure:session:${token}`;
const activeSessionKey = (workerId: string, workerTypeId: string) =>
  `connection:secure:active:${workerTypeId}:${workerId}`;

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
    workerRuntimeRepository?: Record<string, jest.Mock>;
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
  const workerRuntimeRepository = overrides.workerRuntimeRepository ?? {};

  return {
    useCase: new WorkerSecureConnectionSessionUseCase(
      workerService as never,
      (overrides.redis ?? buildRedis().client) as never,
      centrifugoService as never,
      workerGrpcClientService as never,
      workerRuntimeRepository as never
    ),
    workerService,
    centrifugoService,
    workerGrpcClientService,
    workerRuntimeRepository,
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
  it('reuses the pairing activation grant before a Baileys plugin import', async () => {
    const session: ISecureConnectionSession = {
      ...buildSession(EWorkerType.baileys),
      authorized_connection_epoch: '22222222-2222-4222-8222-222222222222',
      connection_attempt_id: '11111111-1111-4111-8111-111111111111',
    };
    const prepareWorkerConnectionPairingActivation = jest.fn(async () => ({
      status: 'granted' as const,
      already_granted: false,
      worker_status_id: EWorkerStatus.disponible,
      worker_status_observed_at: '2026-08-20T21:30:00.000Z',
    }));
    const { useCase, workerGrpcClientService } = buildUseCase({
      workerGrpcClientService: {
        runtimeHealth: jest.fn(async () => ({
          worker_id: session.worker_id,
          account_id: session.account_id,
          worker_type_id: EWorkerType.baileys,
          runtime_generation: 1,
          activated: true,
          standby: false,
        })),
      },
      workerRuntimeRepository: {
        viewByWorkerIdConsistent: jest.fn(async () => ({
          runtime_generation: 1,
          container_id: 'abcdef123456',
          connection_epoch: '33333333-3333-4333-8333-333333333333',
        })),
        prepareWorkerConnectionPairingActivation,
      },
    });

    const authorized = await (
      useCase as unknown as {
        authorizeBaileysSecureImportConnectionEpoch(
          t: (key: string) => string,
          secureSession: ISecureConnectionSession,
          serverId: string,
          debugTraceId?: string
        ): Promise<ISecureConnectionSession>;
      }
    ).authorizeBaileysSecureImportConnectionEpoch(
      (key: string) => key,
      session,
      'server-1',
      'secure-import-test'
    );

    expect(authorized.authorized_connection_epoch).toBe(
      session.authorized_connection_epoch
    );
    expect(workerGrpcClientService.runtimeHealth).toHaveBeenCalledWith(
      'server-1',
      { worker_id: session.worker_id },
      5_000
    );
    expect(prepareWorkerConnectionPairingActivation).toHaveBeenCalledWith({
      worker_id: session.worker_id,
      account_id: session.account_id,
      provider: 'baileys',
      expected_runtime_generation: 1,
      expected_container_id: 'abcdef123456',
      expected_connection_epoch: '33333333-3333-4333-8333-333333333333',
      verified_running_container_id: 'abcdef123456',
      connection_attempt_id: session.connection_attempt_id,
      authorized_connection_epoch: session.authorized_connection_epoch,
      expires_at: session.expires_at,
    });
  });

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

  it('keeps the WhatsMeow consumer positioning window retryable without relaxing Kafka readiness', () => {
    const { useCase } = buildUseCase();

    const readiness = (
      useCase as unknown as {
        resolveRuntimeHealthReadiness: (
          health: IWorkerRuntimeHealthResponseProto,
          session: ISecureConnectionSession,
          phoneFallback?: string | null
        ) => { hardFailure: boolean; ready: boolean; reason?: string };
      }
    ).resolveRuntimeHealthReadiness(
      buildReadyHealth(EWorkerType.whatsmeow, {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        kafka_consumers_authorized: false,
        kafka_unhealthy: true,
        runtime_health_schema_version: 2,
      }),
      buildSession(EWorkerType.whatsmeow)
    );

    expect(readiness.hardFailure).toBe(false);
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toContain('kafka_consumers_authorized');
    expect(readiness.reason).toContain('kafka_unhealthy');
  });

  it('runs WhatsMeow consumer positioning validation in background', () => {
    const { useCase } = buildUseCase();
    const shouldContinue = (
      useCase as unknown as {
        shouldContinueImportValidationInBackground: (
          session: ISecureConnectionSession,
          imported: {
            authenticated?: boolean;
            degraded_reason?: string;
            provider_state?: string;
          },
          readiness: { ready: boolean }
        ) => boolean;
      }
    ).shouldContinueImportValidationInBackground.bind(useCase);

    expect(
      shouldContinue(
        buildSession(EWorkerType.whatsmeow),
        {
          authenticated: true,
          degraded_reason: 'command_ingress_positioning',
          provider_state: 'connected',
        },
        { ready: false }
      )
    ).toBe(true);
    expect(
      shouldContinue(
        buildSession(EWorkerType.whatsmeow),
        {
          authenticated: false,
          degraded_reason: 'logged_out',
          provider_state: 'disconnected',
        },
        { ready: false }
      )
    ).toBe(false);
  });

  it('uses only the provider-appropriate manager stability window after runtime readiness', () => {
    const { useCase } = buildUseCase();
    const resolveStableMs = (
      useCase as unknown as {
        resolveSecureImportValidationStableMs: (
          session: ISecureConnectionSession,
          importedReadiness: { ready?: boolean }
        ) => number;
      }
    ).resolveSecureImportValidationStableMs.bind(useCase);

    expect(
      resolveStableMs(buildSession(EWorkerType.whatsmeow), { ready: true })
    ).toBe(0);
    expect(
      resolveStableMs(buildSession(EWorkerType.wwebjs), { ready: true })
    ).toBe(5_000);
    expect(
      resolveStableMs(buildSession(EWorkerType.wwebjs), { ready: false })
    ).toBe(5_000);
    expect(
      resolveStableMs(buildSession(EWorkerType.baileys), { ready: true })
    ).toBe(20_000);
  });

  it('uses a longer runtime validation window for WWebJS imports', () => {
    const { useCase } = buildUseCase();
    const resolveTimeoutMs = (
      useCase as unknown as {
        resolveSecureImportValidationTimeoutMs: (
          session: ISecureConnectionSession
        ) => number;
      }
    ).resolveSecureImportValidationTimeoutMs.bind(useCase);

    expect(resolveTimeoutMs(buildSession(EWorkerType.baileys))).toBe(60_000);
    expect(resolveTimeoutMs(buildSession(EWorkerType.whatsmeow))).toBe(60_000);
    expect(resolveTimeoutMs(buildSession(EWorkerType.wwebjs))).toBe(180_000);
  });

  it('keeps WWebJS Authenticator uploads responsive while restore validation runs in background', async () => {
    const redis = buildRedis();
    const session: ISecureConnectionSession = {
      ...buildSession(EWorkerType.wwebjs),
      status: 'wa_ready',
    };
    redis.store.set(sessionKey(session.token), JSON.stringify(session));
    const importSecureSession = jest.fn(async () => ({
      account_id: session.account_id,
      authenticated: false,
      can_receive_runtime: false,
      can_send: false,
      code: ECodeMessage.awaitConnection,
      connection_attempt_id: session.connection_attempt_id,
      provider_state: 'secure_import_restore_starting',
      reason: 'secure_import_restore_started',
      session_ready: false,
      status: 'connecting',
      worker_id: session.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: EWorkerType.wwebjs,
    }));
    const runtimeHealth = jest.fn(
      () => new Promise<IWorkerRuntimeHealthResponseProto>(() => undefined)
    );
    const { useCase } = buildUseCase({
      redis: redis.client,
      workerGrpcClientService: {
        importSecureSession,
        runtimeHealth,
      },
    });

    const response = await useCase.receiveSessionPackage(
      ((key: string) => key) as never,
      {
        token: session.token,
        package: {
          created_at: '2026-01-01T00:00:00.000Z',
          format_version: 'underchat-wa-web-session-v1',
          payload: {
            wwebjs_local_auth: {
              files: {
                'Default/Cookies': {
                  data: 'cookie-data',
                  encoding: 'utf8',
                },
              },
            },
            whatsapp_web_creds: {
              me: { id: '556192037138:0@s.whatsapp.net' },
            },
          },
          source: 'whatsapp_web',
          target_provider: 'wwebjs',
        },
      }
    );

    expect(response.status).toBe('validating_worker');
    expect(importSecureSession).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        account_id: session.account_id,
        connection_attempt_id: session.connection_attempt_id,
        target_provider: 'wwebjs',
        worker_id: session.worker_id,
      })
    );
    expect(runtimeHealth).toHaveBeenCalledWith('server-1', {
      worker_id: session.worker_id,
    });
    expect(
      JSON.parse(redis.store.get(sessionKey(session.token)) ?? '{}')
    ).toMatchObject({
      status: 'validating_worker',
    });
  });

  it('dispatches WWebJS packages sent by the Chrome extension to the worker', async () => {
    const redis = buildRedis();
    const session: ISecureConnectionSession = {
      ...buildSession(EWorkerType.wwebjs),
      status: 'wa_ready',
    };
    redis.store.set(sessionKey(session.token), JSON.stringify(session));
    const importSecureSession = jest.fn(async () => ({
      account_id: session.account_id,
      authenticated: false,
      can_receive_runtime: false,
      can_send: false,
      code: ECodeMessage.awaitConnection,
      connection_attempt_id: session.connection_attempt_id,
      provider_state: 'secure_import_restore_starting',
      reason: 'secure_import_restore_started',
      session_ready: false,
      status: 'connecting',
      worker_id: session.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: EWorkerType.wwebjs,
    }));
    const runtimeHealth = jest.fn(
      () => new Promise<IWorkerRuntimeHealthResponseProto>(() => undefined)
    );
    const { useCase } = buildUseCase({
      redis: redis.client,
      workerGrpcClientService: {
        importSecureSession,
        runtimeHealth,
      },
    });

    await expect(
      useCase.receiveSessionPackage(((key: string) => key) as never, {
        token: session.token,
        package: {
          created_at: '2026-01-01T00:00:00.000Z',
          format_version: 'underchat-wa-web-session-v1',
          payload: {
            chrome_extension: {
              version: '1.0.1',
            },
            whatsapp_web_creds: {
              me: { id: '556192037138:0@s.whatsapp.net' },
            },
          },
          source: 'whatsapp_web',
          target_provider: 'wwebjs',
        },
      })
    ).resolves.toMatchObject({ status: 'validating_worker' });

    expect(importSecureSession).toHaveBeenCalledWith(
      'server-1',
      expect.objectContaining({
        target_provider: 'wwebjs',
        worker_id: session.worker_id,
      })
    );
  });

  it('detects WWebJS secure import restores that make no runtime progress', () => {
    const { useCase } = buildUseCase();
    const resolveNoProgressReason = (
      useCase as unknown as {
        resolveWwebjsNoProgressReason: (
          session: ISecureConnectionSession,
          health: IWorkerRuntimeHealthResponseProto | undefined,
          reason: string | undefined,
          elapsedMs: number
        ) => string | null;
      }
    ).resolveWwebjsNoProgressReason.bind(useCase);

    expect(
      resolveNoProgressReason(
        buildSession(EWorkerType.wwebjs),
        {
          provider_state: 'UNLAUNCHED',
          degraded_reason: 'connection_launching',
        },
        'secure_import_runtime_not_ready:provider_state,degraded_reason',
        45_000
      )
    ).toBeNull();
    expect(
      resolveNoProgressReason(
        buildSession(EWorkerType.wwebjs),
        {
          provider_state: 'missing_client',
          degraded_reason: 'No client instance',
        },
        'secure_import_runtime_not_ready:provider_state,degraded_reason:No client instance',
        45_000
      )
    ).toBe('secure_import_wwebjs_no_progress:No client instance');
    expect(
      resolveNoProgressReason(
        buildSession(EWorkerType.wwebjs),
        {
          provider_state: 'UNLAUNCHED',
          degraded_reason: 'connection_launching',
        },
        'secure_import_runtime_not_ready:provider_state,degraded_reason',
        20_000
      )
    ).toBeNull();
    expect(
      resolveNoProgressReason(
        buildSession(EWorkerType.baileys),
        {
          provider_state: 'UNLAUNCHED',
          degraded_reason: 'connection_launching',
        },
        'secure_import_runtime_not_ready:provider_state,degraded_reason',
        45_000
      )
    ).toBeNull();
  });

  it('does not expose WWebJS restore-started marker as the final failure message', () => {
    const { useCase } = buildUseCase();
    const message = (
      useCase as unknown as {
        resolveImportFailureMessage: (
          imported: { reason?: string },
          readiness: { reason?: string }
        ) => string;
      }
    ).resolveImportFailureMessage(
      { reason: 'secure_import_restore_started' },
      {
        reason:
          'secure_import_runtime_not_ready:provider_state:Waiting failed: 30000ms exceeded',
      }
    );

    expect(message).toBe(
      'A sessão foi enviada, mas o WWebJS não confirmou a conexão dentro do tempo esperado.'
    );
    expect(
      (
        useCase as unknown as {
          resolveImportFailureMessage: (
            imported: { reason?: string },
            readiness: { reason?: string }
          ) => string;
        }
      ).resolveImportFailureMessage(
        { reason: 'secure_import_restore_started' },
        {}
      )
    ).toBe(
      'A sessão foi enviada e o WWebJS iniciou a restauração, mas não confirmou a conexão.'
    );
  });

  it('recovers validating whatsmeow sessions from authenticated web polling when runtime is already ready', async () => {
    const redis = buildRedis();
    const session: ISecureConnectionSession = {
      ...buildSession(EWorkerType.whatsmeow),
      status: 'validating_worker',
      upload_received_at: '2026-01-01T00:01:00.000Z',
      imported_at: '2026-01-01T00:01:10.000Z',
    };
    redis.store.set(sessionKey(session.token), JSON.stringify(session));
    const {
      useCase,
      workerGrpcClientService,
      workerService,
      centrifugoService,
    } = buildUseCase({
      redis: redis.client,
      workerGrpcClientService: {
        runtimeHealth: jest.fn(async () =>
          buildReadyHealth(EWorkerType.whatsmeow)
        ),
      },
    });

    const response = await useCase.viewAuthenticated(
      ((key: string) => key) as never,
      {
        accountId: session.account_id,
        workerId: session.worker_id,
        token: session.token,
      }
    );

    expect(response.status).toBe('connected_confirmed');
    expect(response.token).toBe(session.token);
    expect(response.phone).toBe('556192037138');
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
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue(session.account_id),
      expect.objectContaining({
        worker_id: session.worker_id,
        worker_status_id: EWorkerStatus.online,
        phone: '556192037138',
      })
    );
  });

  it('does not recover authenticated web polling while whatsmeow import is still in progress', async () => {
    const redis = buildRedis();
    const session: ISecureConnectionSession = {
      ...buildSession(EWorkerType.whatsmeow),
      status: 'importing',
      upload_received_at: '2026-01-01T00:01:00.000Z',
    };
    redis.store.set(sessionKey(session.token), JSON.stringify(session));
    const { useCase, workerGrpcClientService, workerService } = buildUseCase({
      redis: redis.client,
      workerGrpcClientService: {
        runtimeHealth: jest.fn(async () =>
          buildReadyHealth(EWorkerType.whatsmeow)
        ),
      },
    });

    const response = await useCase.viewAuthenticated(
      ((key: string) => key) as never,
      {
        accountId: session.account_id,
        workerId: session.worker_id,
        token: session.token,
      }
    );

    expect(response.status).toBe('importing');
    expect(workerGrpcClientService.runtimeHealth).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerPhoneStatusConnectionDate
    ).not.toHaveBeenCalled();
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

  it('allows the helper to cancel a pre-upload session when the native app closes', async () => {
    const redis = buildRedis();
    const session: ISecureConnectionSession = {
      ...buildSession(EWorkerType.baileys),
      status: 'wa_ready',
    };
    redis.store.set(sessionKey(session.token), JSON.stringify(session));
    redis.store.set(
      activeSessionKey(session.worker_id, session.worker_type_id as string),
      session.token
    );
    const { useCase, centrifugoService } = buildUseCase({
      redis: redis.client,
    });

    const response = await useCase.updateHelperStatus(
      ((key: string) => key) as never,
      {
        token: session.token,
        status: 'cancelled',
      }
    );

    expect(response.status).toBe('cancelled');
    expect(response.message).toBe('helper_closed');
    expect(
      redis.store.has(
        activeSessionKey(session.worker_id, session.worker_type_id as string)
      )
    ).toBe(false);
    expect(
      JSON.parse(redis.store.get(sessionKey(session.token)) ?? '{}')
    ).toMatchObject({
      status: 'cancelled',
      fail_reason: 'helper_closed',
    });
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue(session.account_id),
      expect.objectContaining({
        secure_connection: expect.objectContaining({
          status: 'cancelled',
          token_hash: session.token_hash,
        }),
      })
    );
  });

  it('does not let helper cancellation override a manager-owned import', async () => {
    const redis = buildRedis();
    const session: ISecureConnectionSession = {
      ...buildSession(EWorkerType.whatsmeow),
      status: 'importing',
      upload_received_at: '2026-01-01T00:01:00.000Z',
    };
    redis.store.set(sessionKey(session.token), JSON.stringify(session));
    const { useCase, workerGrpcClientService } = buildUseCase({
      redis: redis.client,
      workerGrpcClientService: {
        runtimeHealth: jest.fn(async () =>
          buildReadyHealth(EWorkerType.whatsmeow, {
            session_ready: false,
            can_send: false,
            can_receive_runtime: false,
          })
        ),
      },
    });

    const response = await useCase.updateHelperStatus(
      ((key: string) => key) as never,
      {
        token: session.token,
        status: 'cancelled',
      }
    );

    expect(response.status).toBe('importing');
    expect(workerGrpcClientService.runtimeHealth).toHaveBeenCalledWith(
      'server-1',
      { worker_id: 'worker-1' }
    );
    expect(
      JSON.parse(redis.store.get(sessionKey(session.token)) ?? '{}')
    ).toMatchObject({
      status: 'importing',
    });
  });
});
