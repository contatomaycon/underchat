jest.mock('@whiskeysockets/baileys', () => ({
  BAILEYS_POSTGRES_RECORD_CODEC_VERSION: 1,
  BAILEYS_POSTGRES_SESSION_FORMAT: 'baileys-provider-record-protobuf-v1',
  BAILEYS_POSTGRES_SESSION_API_VERSION: 3,
  encodeBaileysPostgresRecord: jest.fn(async (value: unknown) =>
    Uint8Array.from(Buffer.from(JSON.stringify(value)))
  ),
  decodeBaileysPostgresRecord: jest.fn(async (payload: Uint8Array) =>
    JSON.parse(Buffer.from(payload).toString('utf8'))
  ),
  usePostgresAuthState: jest.fn(),
}));

import fs from 'node:fs';
import path from 'node:path';
import * as NativeBaileys from '@whiskeysockets/baileys';
import type { Pool } from 'pg';
import {
  BAILEYS_POSTGRES_RECORD_CODEC_VERSION,
  BAILEYS_POSTGRES_SESSION_API_VERSION,
  BAILEYS_POSTGRES_SESSION_FORMAT,
  BaileysCanonicalCodecError,
  BaileysPostgresAuthStateStore,
  BaileysSessionFenceError,
  decodeBaileysPostgresRecord,
  encodeBaileysPostgresRecord,
} from '@core/services/baileys/stores/postgresAuthState.store';

const WORKER_ID = '0198b905-1fb1-7b4f-9c6d-dbd24078ef11';
const ACCOUNT_ID = '0198b905-1fb1-7b4f-9c6d-dbd24078ef12';
const WRITER_EPOCH = '0198b905-35db-75de-a48f-99dd9133273b';
const HANDOFF_ID = '0198b905-35db-75de-a48f-99dd9133273c';
const OPERATION_ID = '0198b905-35db-75de-a48f-99dd9133273d';
const CAPABILITY = 'raw-runtime-capability-do-not-log-000000000002';

type NativeModuleMock = {
  encodeBaileysPostgresRecord: jest.Mock;
  decodeBaileysPostgresRecord: jest.Mock;
  usePostgresAuthState: jest.Mock;
};

const nativeModule = NativeBaileys as unknown as NativeModuleMock;
const fakePool = {
  applicationName: 'adapter-contract-only',
} as unknown as Pool;

function makeNativeState() {
  return {
    state: {
      creds: { registered: true },
      keys: { get: jest.fn(), set: jest.fn() },
    },
    saveCreds: jest.fn(async () => undefined),
    lease: {
      assertUsable: jest.fn(),
      snapshot: undefined as
        | {
            sessionId: string;
            ownerId: string;
            fencingToken: string;
          }
        | undefined,
    },
    store: { revisionId: '41' },
    assertFence: jest.fn(async () => undefined),
    hasRestorableSession: jest.fn(() => true),
    hasPendingHandoff: jest.fn(() => false),
    getRevisionInfo: jest.fn(() => ({ revisionId: '41', status: 'active' })),
    stageImport: jest.fn(async (_records: unknown, _format: string) => ({
      revisionId: '42',
      previousActiveRevisionId: '41',
      previousRevisionId: '40',
      expectedJid: 'hashed-by-native-library',
    })),
    promoteStagedImport: jest.fn(async (_candidate: unknown) => undefined),
    rollbackStagedImport: jest.fn(
      async (_candidate: unknown, _errorCode?: string) => undefined
    ),
    promotePendingHandoff: jest.fn(async () => false),
    rollbackPendingHandoff: jest.fn(async (_errorCode?: string) => false),
    clearSession: jest.fn(async () => undefined),
    checkpoint: jest.fn(async () => ({
      revisionId: '41',
      checksumSha256: 'e'.repeat(64),
      sizeBytes: 2048,
      recordCount: 8,
      persistedAt: '2026-08-03T12:00:00.000Z',
    })),
    pauseWritesForHandoff: jest.fn(),
    resumeWrites: jest.fn(),
    authorizeProviderHandoff: jest.fn(async () => ({ authorized: true })),
    beginPostQuantumServerRollback: jest.fn(async () => undefined),
    persistPostQuantumServerRollback: jest.fn(async () => undefined),
    getPendingPostQuantumServerRollback: jest.fn(async () => undefined),
    completePostQuantumServerRollbackRecovery: jest.fn(async () => undefined),
    prepareProviderHandoff: jest.fn(async (_input: unknown) => ({
      revisionId: '41',
      checksumSha256: 'f'.repeat(64),
      sizeBytes: 4096,
      recordCount: 12,
      persistedAt: '2026-08-03T12:00:00.000Z',
      handoffId: HANDOFF_ID,
      lifecycleOperationId: OPERATION_ID,
      targetProvider: 'whatsmeow' as const,
    })),
    closeForHandoff: jest.fn(async () => true),
    close: jest.fn(async () => undefined),
  };
}

function makeStore(
  overrides: Partial<
    ConstructorParameters<typeof BaileysPostgresAuthStateStore>[0]
  > = {}
) {
  return new BaileysPostgresAuthStateStore({
    workerId: WORKER_ID,
    writerGeneration: 7,
    writerEpoch: WRITER_EPOCH,
    runtimeCapability: CAPABILITY,
    pool: fakePool,
    debugEnabled: false,
    ...overrides,
  });
}

async function openStore() {
  const native = makeNativeState();
  nativeModule.usePostgresAuthState.mockResolvedValueOnce(native);
  const store = makeStore();
  await store.loadAuthenticationState();
  return { native, store };
}

function installReadyPqBootstrap(native: ReturnType<typeof makeNativeState>) {
  const lastResortKeyId = 101;
  native.state.keys.get.mockImplementation(
    async (type: string, ids: string[]) => {
      if (type === 'pq-pre-key-state') {
        return {
          state: {
            codecVersion: 1,
            algorithm: 'ML-KEM-1024',
            nextPreKeyId: 102,
            migrated: true,
            lastResortKeyId,
            preKeyIds: [],
            pendingPreKeyIds: [],
          },
        };
      }
      if (type === 'pq-last-resort-key' && ids[0] === String(lastResortKeyId)) {
        return {
          [lastResortKeyId]: {
            keyId: lastResortKeyId,
            keyPair: {
              public: Buffer.alloc(1_568, 1),
              private: Buffer.alloc(3_168, 2),
            },
            signature: Buffer.alloc(64, 3),
            timestampMs: 1_700_000_000_000,
            sentToServer: true,
          },
        };
      }
      return {};
    }
  );
}

describe('Baileys PostgreSQL native adapter contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pins the native ABI, codec and session format expected by Underchat', () => {
    expect(BAILEYS_POSTGRES_SESSION_API_VERSION).toBe(3);
    expect(BAILEYS_POSTGRES_RECORD_CODEC_VERSION).toBe(1);
    expect(BAILEYS_POSTGRES_SESSION_FORMAT).toBe(
      'baileys-provider-record-protobuf-v1'
    );
  });

  it('validates immutable session identity and lease timing before opening', () => {
    expect(() => makeStore({ workerId: 'not-a-uuid' })).toThrow(
      'WORKER_ID must be a UUID'
    );
    expect(() => makeStore({ writerGeneration: 0 })).toThrow(
      'RUNTIME_GENERATION must be a positive integer'
    );
    expect(() => makeStore({ writerEpoch: 'not-a-uuid' })).toThrow(
      'WORKER_WRITER_EPOCH must be a UUID'
    );
    expect(() => makeStore({ runtimeCapability: 'short' })).toThrow(
      'WORKER_RUNTIME_CAPABILITY is invalid'
    );
    expect(() =>
      makeStore({
        leaseTtlMs: 10_000,
        renewIntervalMs: 6_000,
        leaseSafetyMarginMs: 4_000,
      })
    ).toThrow('baileys_postgres_lease_timing_invalid');
    expect(nativeModule.usePostgresAuthState).not.toHaveBeenCalled();
  });

  it('delegates codec operations to Baileys without a local compatibility path', async () => {
    const encoded = await encodeBaileysPostgresRecord({ hello: 'world' });
    expect(Buffer.isBuffer(encoded)).toBe(true);
    expect(nativeModule.encodeBaileysPostgresRecord).toHaveBeenCalledWith({
      hello: 'world',
    });

    await expect(decodeBaileysPostgresRecord(encoded)).resolves.toEqual({
      hello: 'world',
    });
    expect(nativeModule.decodeBaileysPostgresRecord).toHaveBeenCalledWith(
      encoded
    );

    nativeModule.encodeBaileysPostgresRecord.mockRejectedValueOnce(
      Object.assign(new Error('native codec failed'), {
        code: 'native_codec_error',
      })
    );
    await expect(
      encodeBaileysPostgresRecord({ invalid: true })
    ).rejects.toMatchObject({
      name: 'BaileysSessionFenceError',
      code: 'native_codec_error',
    });
  });

  it('opens through the native factory with no caller-selected revision', async () => {
    const onLeaseLost = jest.fn();
    const native = makeNativeState();
    nativeModule.usePostgresAuthState.mockResolvedValueOnce(native);
    const store = makeStore({ onLeaseLost });

    const authentication = await store.loadAuthenticationState();
    expect(authentication.state).toBe(native.state);
    expect(authentication.saveCreds).toBe(native.saveCreds);
    expect(nativeModule.usePostgresAuthState).toHaveBeenCalledTimes(1);

    const options = nativeModule.usePostgresAuthState.mock.calls[0][0];
    expect(options).toMatchObject({
      database: fakePool,
      sessionId: WORKER_ID,
      generation: 7,
      epoch: WRITER_EPOCH,
      capability: CAPABILITY,
      debug: false,
      ttlMs: 30_000,
      renewIntervalMs: 5_000,
      safetyMarginMs: 5_000,
      autoRenew: true,
    });
    expect(options.ownerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(options.ownerId).not.toBe(WRITER_EPOCH);
    expect(Object.hasOwn(options, 'revisionId')).toBe(false);

    await options.onLost(
      Object.assign(new Error('lease expired'), { code: 'LEASE_LOST' })
    );
    expect(onLeaseLost).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'BaileysSessionFenceError',
        code: 'LEASE_LOST',
      })
    );

    await store.loadAuthenticationState();
    expect(nativeModule.usePostgresAuthState).toHaveBeenCalledTimes(1);
    await store.close();
    expect(native.close).toHaveBeenCalledTimes(1);
  });

  it('retries a native store open after a transient connection-epoch fence rejection', async () => {
    const native = makeNativeState();
    nativeModule.usePostgresAuthState
      .mockRejectedValueOnce(
        Object.assign(new Error('whatsapp connection epoch was disconnected'), {
          code: 'REVISION_INVALID',
        })
      )
      .mockResolvedValueOnce(native);
    const store = makeStore();

    await expect(store.loadAuthenticationState()).rejects.toMatchObject({
      name: 'BaileysCanonicalCodecError',
      code: 'REVISION_INVALID',
    });
    await expect(store.loadAuthenticationState()).resolves.toEqual({
      state: native.state,
      saveCreds: native.saveCreds,
    });
    expect(nativeModule.usePostgresAuthState).toHaveBeenCalledTimes(2);

    await store.close();
  });

  it('uses a distinct lease owner per store instance while keeping the writer epoch', async () => {
    const firstNative = makeNativeState();
    const secondNative = makeNativeState();
    nativeModule.usePostgresAuthState
      .mockResolvedValueOnce(firstNative)
      .mockResolvedValueOnce(secondNative);

    const first = makeStore();
    const second = makeStore();
    await first.loadAuthenticationState();
    await second.loadAuthenticationState();

    const firstOptions = nativeModule.usePostgresAuthState.mock.calls[0][0];
    const secondOptions = nativeModule.usePostgresAuthState.mock.calls[1][0];
    expect(firstOptions.epoch).toBe(WRITER_EPOCH);
    expect(secondOptions.epoch).toBe(WRITER_EPOCH);
    expect(firstOptions.ownerId).not.toBe(secondOptions.ownerId);

    await first.close();
    await first.close();
    expect(firstNative.close).toHaveBeenCalledTimes(1);
    await expect(first.loadAuthenticationState()).rejects.toMatchObject({
      code: 'baileys_session_store_closed',
    });
    await second.close();
  });

  it('exposes proof only from the exact acquired native lease owner', async () => {
    const native = makeNativeState();
    nativeModule.usePostgresAuthState.mockImplementationOnce(
      async (options: { sessionId: string; ownerId: string }) => {
        native.lease.snapshot = {
          sessionId: options.sessionId,
          ownerId: options.ownerId,
          fencingToken: '73',
        };
        return native;
      }
    );
    const store = makeStore();
    expect(store.getConnectionStatusLeaseProof()).toBeUndefined();
    await store.loadAuthenticationState();
    const proof = store.getConnectionStatusLeaseProof();
    expect(proof).toEqual({
      ownerId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      fencingToken: '73',
    });
    expect(native.lease.assertUsable).toHaveBeenCalledTimes(1);

    native.lease.assertUsable.mockImplementationOnce(() => {
      throw new Error('postgres_session_lease_expired_locally');
    });
    expect(store.getConnectionStatusLeaseProof()).toBeUndefined();

    const acquiredSnapshot = native.lease.snapshot;
    expect(acquiredSnapshot).toBeDefined();
    if (!acquiredSnapshot) {
      throw new Error('native_lease_snapshot_missing');
    }
    native.lease.snapshot = {
      ...acquiredSnapshot,
      ownerId: '0198b905-35db-75de-a48f-99dd9133273e',
    };
    expect(store.getConnectionStatusLeaseProof()).toBeUndefined();
  });

  it('fails closed when the installed library does not return lifecycle API v3', async () => {
    nativeModule.usePostgresAuthState.mockResolvedValueOnce({
      state: {},
      lease: { assertUsable: jest.fn() },
      store: { revisionId: '41' },
      saveCreds: jest.fn(),
    });
    await expect(makeStore().loadAuthenticationState()).rejects.toMatchObject({
      code: 'baileys_native_postgres_session_abi_incompatible:lifecycle_methods',
    });
  });

  it('delegates fence checks and revision discovery to the opened native state', async () => {
    const { native, store } = await openStore();
    expect(store.hasRestorableSessionCached()).toBe(true);
    expect(native.hasRestorableSession).toHaveBeenCalledTimes(1);

    await expect(store.openForHandoff()).resolves.toEqual({
      revisionId: 41,
      status: 'active',
    });
    expect(native.assertFence).toHaveBeenCalledTimes(1);
    expect(native.getRevisionInfo).toHaveBeenCalledTimes(1);

    await store.assertFence();
    expect(native.assertFence).toHaveBeenCalledTimes(2);
    store.pauseWritesForHandoff();
    expect(native.pauseWritesForHandoff).toHaveBeenCalledTimes(1);
  });

  it('keeps the exact native candidate across stage, promotion and rollback', async () => {
    const { native, store } = await openStore();
    const records = [
      {
        category: 'creds' as const,
        id: 'current',
        value: { registered: true },
      },
    ];
    const staged = await store.stageImport(
      records,
      BAILEYS_POSTGRES_SESSION_FORMAT
    );
    expect(staged).toEqual({
      revisionId: 42,
      previousActiveRevisionId: 41,
      previousRevisionId: 40,
    });
    expect(native.stageImport).toHaveBeenCalledWith(
      records,
      BAILEYS_POSTGRES_SESSION_FORMAT
    );

    const exactNativeCandidate = await native.stageImport.mock.results[0].value;
    await store.promoteImport(staged);
    expect(native.promoteStagedImport.mock.calls[0][0]).toBe(
      exactNativeCandidate
    );

    const stagedForRollback = await store.stageImport(
      records,
      BAILEYS_POSTGRES_SESSION_FORMAT
    );
    await store.rollbackImport(stagedForRollback, 'identity_mismatch');
    expect(native.rollbackStagedImport).toHaveBeenCalledWith(
      expect.objectContaining({
        revisionId: '42',
        expectedJid: 'hashed-by-native-library',
      }),
      'identity_mismatch'
    );

    await expect(store.promoteImport(stagedForRollback)).rejects.toMatchObject({
      code: 'baileys_session_import_candidate_stale',
    });
  });

  it('delegates pending handoff promotion, rollback and destructive clear', async () => {
    const { native, store } = await openStore();
    native.hasPendingHandoff.mockReturnValue(true);
    installReadyPqBootstrap(native);
    expect(store.hasPendingHandoff()).toBe(true);

    native.promotePendingHandoff.mockResolvedValueOnce(true);
    await store.promoteStagedImportIfReady();
    expect(native.state.keys.get).toHaveBeenNthCalledWith(
      1,
      'pq-pre-key-state',
      ['state']
    );
    expect(native.state.keys.get).toHaveBeenNthCalledWith(
      2,
      'pq-last-resort-key',
      ['101']
    );
    expect(native.promotePendingHandoff).toHaveBeenCalledTimes(1);

    native.rollbackPendingHandoff.mockResolvedValueOnce(true);
    await expect(store.rollbackPendingHandoff('restore_failed')).resolves.toBe(
      true
    );
    expect(native.rollbackPendingHandoff).toHaveBeenCalledWith(
      'restore_failed'
    );

    await store.clearSession();
    expect(native.clearSession).toHaveBeenCalledTimes(1);
  });

  it('refuses to promote a provider handoff before PQ bootstrap is durably complete', async () => {
    const { native, store } = await openStore();
    native.hasPendingHandoff.mockReturnValue(true);
    native.rollbackPendingHandoff.mockResolvedValueOnce(true);

    await expect(store.promoteStagedImportIfReady()).rejects.toBeInstanceOf(
      BaileysCanonicalCodecError
    );
    expect(native.rollbackPendingHandoff).toHaveBeenCalledWith(
      'baileys_pq_bootstrap_incomplete'
    );
    expect(native.state.keys.get).toHaveBeenCalledWith('pq-pre-key-state', [
      'state',
    ]);
    expect(native.promotePendingHandoff).not.toHaveBeenCalled();
  });

  it('fails closed when the pre-CAS PQ rollback is rejected', async () => {
    const { native, store } = await openStore();
    native.hasPendingHandoff.mockReturnValue(true);
    native.rollbackPendingHandoff.mockRejectedValueOnce(
      new Error('rollback_rejected_for_test')
    );

    await expect(store.promoteStagedImportIfReady()).rejects.toMatchObject({
      name: 'BaileysCanonicalCodecError',
      code: 'baileys_pq_bootstrap_rollback_rejected',
      cause: expect.any(AggregateError),
    });
    expect(native.rollbackPendingHandoff).toHaveBeenCalledTimes(1);
    expect(native.promotePendingHandoff).not.toHaveBeenCalled();
  });

  it('never rolls back an ambiguous provider promotion result', async () => {
    const { native, store } = await openStore();
    native.hasPendingHandoff.mockReturnValue(true);
    installReadyPqBootstrap(native);
    native.promotePendingHandoff.mockRejectedValueOnce(
      Object.assign(new Error('connection lost after SQL submission'), {
        code: 'REVISION_INVALID',
      })
    );

    await expect(store.promoteStagedImportIfReady()).rejects.toMatchObject({
      name: 'BaileysSessionFenceError',
      code: 'REVISION_INVALID',
    });
    expect(native.rollbackPendingHandoff).not.toHaveBeenCalled();
  });

  it.each([
    'CODEC_INCOMPATIBLE',
    'PROJECTION_INVALID',
    'SESSION_ISOLATION_VIOLATION',
  ])(
    'maps native terminal candidate error %s without a reconnect fence',
    async (code) => {
      const { native, store } = await openStore();
      native.hasPendingHandoff.mockReturnValue(true);
      installReadyPqBootstrap(native);
      native.promotePendingHandoff.mockRejectedValueOnce(
        Object.assign(new Error(code), { code })
      );

      await expect(store.promoteStagedImportIfReady()).rejects.toMatchObject({
        name: 'BaileysCanonicalCodecError',
        code,
      });
      // The native library owns deterministic pre-CAS compensation. Retrying it
      // here could roll back a promotion whose SQL outcome became ambiguous.
      expect(native.rollbackPendingHandoff).not.toHaveBeenCalled();
    }
  );

  it.each([
    'CODEC_INCOMPATIBLE',
    'PROJECTION_INVALID',
    'SESSION_ISOLATION_VIOLATION',
    'REVISION_INVALID',
  ])(
    'maps deterministic native open error %s to a terminal candidate error',
    async (code) => {
      nativeModule.usePostgresAuthState.mockRejectedValueOnce(
        Object.assign(new Error(code), { code })
      );

      await expect(makeStore().loadAuthenticationState()).rejects.toMatchObject(
        {
          name: 'BaileysCanonicalCodecError',
          code,
        }
      );
    }
  );

  it.each(['LEASE_LOST', 'FENCING_TOKEN_STALE'])(
    'keeps native ownership error %s transient and fenced',
    async (code) => {
      nativeModule.usePostgresAuthState.mockRejectedValueOnce(
        Object.assign(new Error(code), { code })
      );

      await expect(makeStore().loadAuthenticationState()).rejects.toMatchObject(
        {
          name: 'BaileysSessionFenceError',
          code,
        }
      );
    }
  );

  it('delegates source checkpoint proof and confirmed lease release to Baileys', async () => {
    const { native, store } = await openStore();
    const checkpoint = await store.prepareHandoff({
      accountId: ACCOUNT_ID,
      handoffId: HANDOFF_ID,
      lifecycleOperationId: OPERATION_ID,
      sourceRevisionId: 41,
      targetProvider: 'whatsmeow',
      debugTraceId: 'adapter-contract',
    });
    expect(checkpoint).toEqual({
      revisionId: 41,
      checksumSha256: 'f'.repeat(64),
      sizeBytes: 4096,
      recordCount: 12,
    });
    expect(native.prepareProviderHandoff).toHaveBeenCalledWith({
      handoffId: HANDOFF_ID,
      lifecycleOperationId: OPERATION_ID,
      sourceRevisionId: '41',
      targetProvider: 'whatsmeow',
      traceId: 'adapter-contract',
    });

    await expect(store.closeForHandoff()).resolves.toBe(true);
    expect(native.closeForHandoff).toHaveBeenCalledTimes(1);
  });

  it('maps native operation failures without hiding their machine-readable code', async () => {
    const { native, store } = await openStore();
    native.assertFence.mockRejectedValueOnce(
      Object.assign(new Error('stale writer'), { code: 'FENCING_TOKEN_STALE' })
    );
    await expect(store.assertFence()).rejects.toEqual(
      expect.objectContaining<Partial<BaileysSessionFenceError>>({
        name: 'BaileysSessionFenceError',
        code: 'FENCING_TOKEN_STALE',
      })
    );
  });

  it('contains no SQL, advisory lock or local provider-record codec implementation', () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'packages/services/baileys/stores/postgresAuthState.store.ts'
      ),
      'utf8'
    );
    expect(source).toContain('usePostgresAuthState');
    expect(source).not.toMatch(/public\.whatsapp/i);
    expect(source).not.toMatch(/[\"'`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(source).not.toMatch(/pg_advisory/i);
    expect(source).not.toMatch(/node:zlib|protobufjs/i);
    expect(source).not.toMatch(/fallback/i);
  });
});
