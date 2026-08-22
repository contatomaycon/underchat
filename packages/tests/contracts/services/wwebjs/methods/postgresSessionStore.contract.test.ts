import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient, QueryResult } from 'pg';
import {
  PostgresWwebjsSessionStore,
  resolveWwebjsCanonicalCompanionIdentity,
  resolveWwebjsNativePostgresStoreFactory,
  WWEBJS_CANONICAL_CODEC_KIND,
  WWEBJS_COMPANION_FINGERPRINT_VERSION,
  WWEBJS_LIFECYCLE_CAPABILITIES,
  WWEBJS_NATIVE_SESSION_KIND,
  WWEBJS_PRIVATE_MODULE_ABI,
  WWEBJS_SESSION_MAX_BYTES,
  WWEBJS_SUPPORTED_WEB_VERSION,
  WwebjsPostgresSessionError,
  type WwebjsNativePostgresStore,
  type WwebjsNativePostgresStoreFactory,
  type WwebjsNativeSessionDescriptor,
  type WwebjsSessionPool,
} from '@core/services/wwebjs/methods/postgresSessionStore';

const WORKER_ID = '019f6f00-0000-7000-8000-000000000001';
const WRITER_EPOCH = '019f6f00-0000-7000-8000-000000000002';
const CAPABILITY = 'runtime-capability-never-log-this-value';

const canonicalAbi = {
  schemaVersion: 17,
  codecKind: WWEBJS_CANONICAL_CODEC_KIND,
  codecVersion: 1,
  moduleAbi: WWEBJS_PRIVATE_MODULE_ABI,
  fingerprintVersion: WWEBJS_COMPANION_FINGERPRINT_VERSION,
  signalScopes: ['default', 'status', 'pq'],
  signalDomainTypes: [0, 1, 128, 129],
  lifecycleCapabilities: WWEBJS_LIFECYCLE_CAPABILITIES,
} as const;

const canonicalProjection = {
  schema_version: 17 as const,
  codec_kind: WWEBJS_CANONICAL_CODEC_KIND,
  codec_version: 1 as const,
  module_abi: WWEBJS_PRIVATE_MODULE_ABI,
  fingerprint_version: WWEBJS_COMPANION_FINGERPRINT_VERSION,
  complete: true as const,
};

function createCanonicalBrowserProjection(webVersion = '2.3000.1027934701') {
  const encoded = (size: number, fill: number) =>
    Buffer.alloc(size, fill).toString('base64');

  return {
    kind: 'wwebjs-canonical-session-v1' as const,
    codec_version: 1,
    module_abi: WWEBJS_PRIVATE_MODULE_ABI,
    web_version: webVersion,
    fingerprint_version: WWEBJS_COMPANION_FINGERPRINT_VERSION,
    complete: true,
    blockers: [],
    capabilities: {
      lid_migrated: false,
      pq_migrated: false,
      pq_upload_enabled: false,
      pq_messaging_enabled: false,
      pq_storage_mode: 'rollout_without_tables',
      pq_pre_key_count: 0,
      pq_last_resort_key_count: 0,
    },
    device: {
      jid: '5511999999999@c.us',
      lid: null,
      facebook_uuid: null,
      registration_id: 1,
      noise_key: encoded(32, 1),
      identity_key: encoded(32, 2),
      signed_pre_key: encoded(32, 3),
      signed_pre_key_id: 1,
      signed_pre_key_sig: encoded(64, 4),
      adv_secret_available: false,
      adv_key: null,
      adv_details: encoded(1, 5),
      adv_account_sig: encoded(64, 6),
      adv_account_sig_key: encoded(32, 7),
      adv_device_sig: encoded(64, 8),
      platform: 'web',
      business_name: '',
      push_name: '',
      lid_migration_ts: 0,
      next_pre_key_id: 2,
      device_fingerprint: '01'.repeat(32),
    },
    provider_state: null,
    transport_state: null,
    tables: {
      identity_keys: [],
      pre_keys: [],
      pq_pre_keys: [],
      pq_pre_key_state: [],
      signal_sessions: [],
      sender_keys: [],
      app_state_sync_keys: [],
      app_state_versions: [],
      app_state_mutation_macs: [],
    },
    record_count: 0,
    size_bytes: 321,
  };
}

function queryResult<Row extends Record<string, unknown>>(
  rows: Row[] = []
): QueryResult<Row> {
  return { command: '', rowCount: rows.length, oid: 0, fields: [], rows };
}

function createPool(): { pool: WwebjsSessionPool; query: jest.Mock } {
  const query = jest.fn(async () => queryResult());
  const client = {
    query,
    release: jest.fn(),
  } as unknown as PoolClient;
  return {
    pool: {
      connect: async () => client,
      query: query as unknown as WwebjsSessionPool['query'],
    },
    query,
  };
}

function activeDescriptor(
  overrides: Partial<WwebjsNativeSessionDescriptor> = {}
): WwebjsNativeSessionDescriptor {
  return {
    session_id: WORKER_ID,
    revision_id: '10',
    revision_status: 'active',
    revision_source: 'checkpoint',
    provider: 'wwebjs',
    generation: 7,
    epoch: WRITER_EPOCH,
    fencing_token: '41',
    web_version: WWEBJS_SUPPORTED_WEB_VERSION,
    ...overrides,
  };
}

function createNativeStore(
  descriptor = activeDescriptor(),
  overrides: Partial<WwebjsNativePostgresStore> = {}
): WwebjsNativePostgresStore {
  return {
    kind: WWEBJS_NATIVE_SESSION_KIND,
    provider: 'wwebjs',
    sessionId: WORKER_ID,
    webVersion: WWEBJS_SUPPORTED_WEB_VERSION,
    webVersionIntegrityPinned: false,
    revisionId: descriptor.revision_id,
    revisionStatus: descriptor.revision_status,
    revisionSource: descriptor.revision_source,
    sourceRevisionId: descriptor.source_revision_id,
    sourceProvider: descriptor.source_provider,
    logger: { revisionId: descriptor.revision_id, log: jest.fn() },
    open: jest.fn(async () => descriptor),
    describe: jest.fn(() => descriptor),
    bindRuntimeWebVersion: jest.fn((version: string) => version),
    renewLease: jest.fn(async () => undefined),
    assertLocalLease: jest.fn(),
    releaseLease: jest.fn(async () => true),
    restoreProfile: jest.fn(async () => true),
    checkpointProfile: jest.fn(async () => ({})),
    consumePendingProjection: jest.fn(async () => undefined),
    consumePendingCanonicalProjection: jest.fn(async () => undefined),
    stageExternalBrowserProjection: jest.fn(async () => descriptor.revision_id),
    persistExternalBrowserBootstrapCanonicalProjection: jest.fn(
      async (projection) => ({
        projection,
        revisionId: descriptor.revision_id,
        recordCount: 0,
        sizeBytes: 0,
      })
    ),
    loadCanonicalProjection: jest.fn(async () => canonicalProjection),
    loadCanonicalRestartAuthority: jest.fn(async () => ({
      projection: canonicalProjection,
      appStateOverlayRequired: false,
      canonicalGeneration: '1',
      profileArtifactId: '018f47a0-0100-7000-8000-000000000006',
      legacy: false,
    })),
    saveCanonicalProjection: jest.fn(async () => ({})),
    saveCanonicalProviderState: jest.fn(async () => undefined),
    preflightReadyIdentity: jest.fn(async (options) => ({
      canonicalProjection: options.canonicalProjection,
      browserJid: '5511999999999@c.us',
      projectedJid: '5511999999999@c.us',
      projectedFingerprint: Buffer.alloc(32, 1),
      trustedFingerprint: Buffer.alloc(32, 1),
      databaseJidPresent: true,
      fingerprintVerified: true,
    })),
    validateReadyIdentity: jest.fn(async () => ({})),
    importProjection: jest.fn(async () => descriptor.revision_id),
    exportProjection: jest.fn(async () => ({
      format_version: 'whatsapp-session-v1' as const,
      source_provider: 'wwebjs' as const,
      session_id: WORKER_ID,
      revision_id: descriptor.revision_id,
    })),
    prepareHandoff: jest.fn(async () => ({})),
    assertAuthorizedHandoff: jest.fn(async () => ({})),
    isHandoffRevision: jest.fn(
      () =>
        descriptor.revision_source === 'handoff' ||
        descriptor.revision_source === 'secure_import'
    ),
    isPairingAllowed: jest.fn(async () => false),
    requiresNoiseMetadataBootstrap: jest.fn(() => false),
    markCanonicalActivationPending: jest.fn(async () => undefined),
    loadPendingCanonicalActivation: jest.fn(async () => undefined),
    promote: jest.fn(async () => ({})),
    commitActivation: jest.fn(async () => ({})),
    finalizeActivation: jest.fn(async () => ({})),
    rollback: jest.fn(async () => ({
      revisionId: descriptor.source_revision_id ?? descriptor.revision_id,
      provider: descriptor.source_provider,
    })),
    delete: jest.fn(async () => undefined),
    close: jest.fn(async () => true),
    ...overrides,
  };
}

function createStore(
  pool: WwebjsSessionPool,
  nativeStoreFactory: WwebjsNativePostgresStoreFactory,
  revisionId?: string
): PostgresWwebjsSessionStore {
  return new PostgresWwebjsSessionStore({
    pool,
    workerId: WORKER_ID,
    writerGeneration: 7,
    writerEpoch: WRITER_EPOCH,
    runtimeCapability: CAPABILITY,
    revisionId,
    debugEnabled: true,
    nativeStoreFactory,
  });
}

class CompleteNativeStore {
  open() {}
  describe() {}
  bindRuntimeWebVersion() {}
  renewLease() {}
  assertLocalLease() {}
  releaseLease() {}
  restoreProfile() {}
  checkpointProfile() {}
  consumePendingProjection() {}
  consumePendingCanonicalProjection() {}
  stageExternalBrowserProjection() {}
  persistExternalBrowserBootstrapCanonicalProjection() {}
  loadCanonicalProjection() {}
  loadCanonicalRestartAuthority() {}
  saveCanonicalProjection() {}
  saveCanonicalProviderState() {}
  preflightReadyIdentity() {}
  validateReadyIdentity() {}
  importProjection() {}
  exportProjection() {}
  prepareHandoff() {}
  assertAuthorizedHandoff() {}
  isHandoffRevision() {}
  isPairingAllowed() {}
  requiresNoiseMetadataBootstrap() {}
  markCanonicalActivationPending() {}
  loadPendingCanonicalActivation() {}
  promote() {}
  commitActivation() {}
  finalizeActivation() {}
  rollback() {}
  delete() {}
  close() {}
}

class CompleteClient {
  getCompanionIdentity() {}
}

const requiredNativeStoreMethods = [
  'open',
  'describe',
  'bindRuntimeWebVersion',
  'renewLease',
  'assertLocalLease',
  'releaseLease',
  'restoreProfile',
  'checkpointProfile',
  'consumePendingProjection',
  'consumePendingCanonicalProjection',
  'stageExternalBrowserProjection',
  'persistExternalBrowserBootstrapCanonicalProjection',
  'loadCanonicalProjection',
  'loadCanonicalRestartAuthority',
  'saveCanonicalProjection',
  'saveCanonicalProviderState',
  'preflightReadyIdentity',
  'validateReadyIdentity',
  'importProjection',
  'exportProjection',
  'prepareHandoff',
  'assertAuthorizedHandoff',
  'isHandoffRevision',
  'isPairingAllowed',
  'requiresNoiseMetadataBootstrap',
  'markCanonicalActivationPending',
  'loadPendingCanonicalActivation',
  'promote',
  'commitActivation',
  'finalizeActivation',
  'rollback',
  'delete',
  'close',
] as const;

describe('PostgresWwebjsSessionStore native adapter contract', () => {
  it('fails closed on a missing API or incompatible canonical ABI', () => {
    expect(() => resolveWwebjsNativePostgresStoreFactory({})).toThrow(
      'wwebjs_native_postgres_session_api_unavailable'
    );
    expect(() =>
      resolveWwebjsNativePostgresStoreFactory({
        PostgresSessionStore: CompleteNativeStore,
        CANONICAL_SESSION_STORE_ABI: {
          ...canonicalAbi,
          fingerprintVersion: 'legacy-v1',
        },
        Client: CompleteClient,
      })
    ).toThrow('wwebjs_native_postgres_session_codec_incompatible');
    expect(() =>
      resolveWwebjsNativePostgresStoreFactory({
        PostgresSessionStore: class {},
        CANONICAL_SESSION_STORE_ABI: canonicalAbi,
        Client: CompleteClient,
      })
    ).toThrow('wwebjs_native_postgres_session_api_incomplete');
    expect(() =>
      resolveWwebjsNativePostgresStoreFactory({
        PostgresSessionStore: CompleteNativeStore,
        CANONICAL_SESSION_STORE_ABI: canonicalAbi,
        Client: CompleteClient,
      })
    ).not.toThrow();
  });

  it.each(requiredNativeStoreMethods)(
    'rejects the native module before Chromium when %s is missing',
    (method) => {
      class IncompleteNativeStore extends CompleteNativeStore {}
      Object.defineProperty(IncompleteNativeStore.prototype, method, {
        configurable: true,
        value: undefined,
      });
      expect(() =>
        resolveWwebjsNativePostgresStoreFactory({
          PostgresSessionStore: IncompleteNativeStore,
          CANONICAL_SESSION_STORE_ABI: canonicalAbi,
          Client: CompleteClient,
        })
      ).toThrow('wwebjs_native_postgres_session_api_incomplete');
    }
  );

  it('rejects a native module without the safe lifecycle ABI', () => {
    const { lifecycleCapabilities: _removed, ...legacyAbi } = canonicalAbi;
    expect(() =>
      resolveWwebjsNativePostgresStoreFactory({
        PostgresSessionStore: CompleteNativeStore,
        CANONICAL_SESSION_STORE_ABI: legacyAbi,
        Client: CompleteClient,
      })
    ).toThrow('wwebjs_native_postgres_session_codec_incompatible');
  });

  it('requires the immutable session fence and raw capability bounds', () => {
    const { pool } = createPool();
    const native = createNativeStore();
    for (const runtimeCapability of ['', 'x'.repeat(31), 'x'.repeat(513)]) {
      expect(
        () =>
          new PostgresWwebjsSessionStore({
            pool,
            workerId: WORKER_ID,
            writerGeneration: 7,
            writerEpoch: WRITER_EPOCH,
            runtimeCapability,
            nativeStoreFactory: () => native,
          })
      ).toThrow('wwebjs_postgres_session_capability_invalid');
    }
  });

  it('accepts only the v2 fingerprint produced after the private ABI preflight', async () => {
    const fingerprint = 'ab'.repeat(32);
    const identity = {
      jid: '5511999999999@c.us',
      companionFingerprint: fingerprint,
      fingerprintVersion: WWEBJS_COMPANION_FINGERPRINT_VERSION,
      moduleAbi: WWEBJS_PRIVATE_MODULE_ABI,
      webVersion: '2.3000.live-test',
    };
    await expect(
      resolveWwebjsCanonicalCompanionIdentity({
        getCompanionIdentity: async () => identity,
      })
    ).resolves.toEqual(identity);
    await expect(
      resolveWwebjsCanonicalCompanionIdentity({
        getCompanionIdentity: async () => ({
          ...identity,
          moduleAbi: 'unknown-private-modules',
        }),
      })
    ).rejects.toMatchObject({ code: 'wwebjs_companion_identity_invalid' });
  });

  it('passes no literal web version and explicitly disables integrity pinning', async () => {
    const { pool, query } = createPool();
    const native = createNativeStore();
    const factory = jest.fn((_options: unknown) => native);
    const store = createStore(pool, factory, '10');

    expect(store.getNativeStore()).toBe(native);
    await expect(
      store.sessionExists({ session: `RemoteAuth-${WORKER_ID}` })
    ).resolves.toBe(true);
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        pool,
        sessionId: WORKER_ID,
        revisionId: '10',
        generation: 7,
        epoch: WRITER_EPOCH,
        runtimeCapability: CAPABILITY,
        webVersionIntegrityPinned: false,
        debugEnabled: true,
        maxProfileBytes: WWEBJS_SESSION_MAX_BYTES,
      })
    );
    expect(factory.mock.calls[0]?.[0]).not.toHaveProperty('webVersion');
    expect(factory.mock.calls[0]?.[0]).not.toHaveProperty('revisionSource');
    expect(factory.mock.calls[0]?.[0]).not.toHaveProperty('storageMigrationId');
    expect(query).not.toHaveBeenCalled();
    expect(JSON.stringify(store)).not.toContain(CAPABILITY);
  });

  it('binds an exact legacy migration source only while the migration UUID is present', () => {
    const migrationId = '019ff000-0000-7000-8000-000000000001';
    const previousMigrationId = process.env.SESSION_STORAGE_MIGRATION_ID;
    process.env.SESSION_STORAGE_MIGRATION_ID = migrationId;
    try {
      const { pool } = createPool();
      const native = createNativeStore();
      const factory = jest.fn(() => native);
      const store = createStore(pool, factory);

      expect(store.getNativeStore()).toBe(native);
      expect(factory).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionSource: 'legacy_volume_migration',
          storageMigrationId: migrationId,
        })
      );
    } finally {
      if (previousMigrationId === undefined) {
        delete process.env.SESSION_STORAGE_MIGRATION_ID;
      } else {
        process.env.SESSION_STORAGE_MIGRATION_ID = previousMigrationId;
      }
    }
  });

  it('resumes only an exact validating legacy-volume candidate during a protected retry', async () => {
    const migrationId = '019ff000-0000-7000-8000-000000000001';
    const previousMigrationId = process.env.SESSION_STORAGE_MIGRATION_ID;
    process.env.SESSION_STORAGE_MIGRATION_ID = migrationId;
    try {
      for (const scenario of [
        {
          status: 'validating',
          source: 'legacy_volume_migration',
          expected: true,
        },
        {
          status: 'staging',
          source: 'legacy_volume_migration',
          expected: false,
        },
        { status: 'validating', source: 'checkpoint', expected: false },
        { status: 'staging', source: 'pairing', expected: false },
      ]) {
        const { pool } = createPool();
        const descriptor = activeDescriptor({
          revision_status: scenario.status,
          revision_source: scenario.source,
        });
        const store = createStore(pool, () => createNativeStore(descriptor));

        await expect(
          store.sessionExists({ session: `RemoteAuth-${WORKER_ID}` })
        ).resolves.toBe(scenario.expected);
      }

      process.env.SESSION_STORAGE_MIGRATION_ID = 'invalid';
      const { pool } = createPool();
      const descriptor = activeDescriptor({
        revision_status: 'validating',
        revision_source: 'legacy_volume_migration',
      });
      const store = createStore(pool, () => createNativeStore(descriptor));
      await expect(
        store.sessionExists({ session: `RemoteAuth-${WORKER_ID}` })
      ).resolves.toBe(false);
    } finally {
      if (previousMigrationId === undefined) {
        delete process.env.SESSION_STORAGE_MIGRATION_ID;
      } else {
        process.env.SESSION_STORAGE_MIGRATION_ID = previousMigrationId;
      }
    }
  });

  it('uses the native 512 MiB artifact ceiling and clamps larger overrides', () => {
    expect(WWEBJS_SESSION_MAX_BYTES).toBe(512 * 1024 * 1024);

    const { pool } = createPool();
    const native = createNativeStore();
    const factory = jest.fn(() => native);
    const store = new PostgresWwebjsSessionStore({
      pool,
      workerId: WORKER_ID,
      writerGeneration: 7,
      writerEpoch: WRITER_EPOCH,
      runtimeCapability: CAPABILITY,
      maxProfileBytes: Number.MAX_SAFE_INTEGER,
      nativeStoreFactory: factory,
    });

    expect(store.getNativeStore()).toBe(native);
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        maxProfileBytes: WWEBJS_SESSION_MAX_BYTES,
      })
    );
  });

  it('exposes the lease owner and token only after the exact native store is open', async () => {
    const { pool } = createPool();
    const descriptor = activeDescriptor({ fencing_token: '77' });
    const native = createNativeStore(descriptor);
    const store = createStore(pool, () => native);

    expect(store.getConnectionStatusLeaseProof()).toBeUndefined();
    await store.open();
    expect(store.getConnectionStatusLeaseProof()).toEqual({
      ownerId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      fencingToken: '77',
    });
    expect(native.assertLocalLease).toHaveBeenCalledTimes(1);

    (native.assertLocalLease as jest.Mock).mockImplementationOnce(() => {
      throw new Error('wwebjs_postgres_lease_expired_locally');
    });
    expect(store.getConnectionStatusLeaseProof()).toBeUndefined();

    descriptor.fencing_token = '0';
    expect(store.getConnectionStatusLeaseProof()).toBeUndefined();
  });

  it('installs the supervisor lease-loss handler before a browser owns the native store', async () => {
    const { pool } = createPool();
    const nativeLeaseLost: Array<
      ((error: Error) => void | Promise<void>) | undefined
    > = [];
    const makeNative = () =>
      createNativeStore(activeDescriptor(), {
        open: jest.fn(async (options) => {
          nativeLeaseLost.push(options?.onLeaseLost);
          return activeDescriptor();
        }),
      });
    const firstNative = makeNative();
    const secondNative = makeNative();
    const factory = jest
      .fn()
      .mockReturnValueOnce(firstNative)
      .mockReturnValueOnce(secondNative);
    const store = createStore(pool, factory);
    const handler = jest.fn(async () => undefined);
    store.setLeaseLostHandler(handler);

    await store.sessionExists({ session: `RemoteAuth-${WORKER_ID}` });
    expect(nativeLeaseLost[0]).toBeDefined();
    await store.close();
    await store.sessionExists({ session: `RemoteAuth-${WORKER_ID}` });
    expect(nativeLeaseLost[1]).toBeDefined();

    const error = new Error('whatsapp_session_lease_lost');
    await nativeLeaseLost[0]?.(error);
    expect(handler).not.toHaveBeenCalled();
    await nativeLeaseLost[1]?.(error);
    expect(handler).toHaveBeenCalledWith(error);
  });

  it('delegates secure import and cross-provider handoff without local SQL', async () => {
    const { pool, query } = createPool();
    const descriptor = activeDescriptor({ revision_source: 'checkpoint' });
    const native = createNativeStore(descriptor, {
      importProjection: jest.fn(async () => '11'),
      prepareHandoff: jest.fn(async () => ({ handoffId: 'handoff-native' })),
    });
    const store = createStore(pool, () => native);

    await expect(
      store.stageCandidate({
        session: `RemoteAuth-${WORKER_ID}`,
        profilePath: '/tmp/wwebjs-import-profile',
      })
    ).resolves.toBe('11');
    expect(native.importProjection).toHaveBeenCalledWith({
      projection: expect.objectContaining({
        format_version: 'whatsapp-session-v1',
        source_provider: 'wwebjs',
        session_id: WORKER_ID,
      }),
      profilePath: '/tmp/wwebjs-import-profile',
      promote: false,
    });
    await expect(store.prepareHandoff('baileys')).resolves.toEqual({
      handoffId: 'handoff-native',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('stages an external browser projection through the native fenced API', async () => {
    const { pool, query } = createPool();
    const descriptor = activeDescriptor({
      revision_status: 'staging',
      revision_source: 'pairing',
    });
    const stageExternalBrowserProjection = jest.fn(async () => '12');
    const native = createNativeStore(descriptor, {
      stageExternalBrowserProjection,
    });
    const store = createStore(pool, () => native);
    const projection = {
      schema_version: 2 as const,
      web_version: '2.3000.1027934701',
      complete: true,
      lossy_records: 0,
      size_bytes: 17,
      indexeddb_stores: [],
      records: [
        {
          namespace: 'local_storage',
          record_key: 'last-wid',
          value: '5511999999999@c.us',
        },
      ],
    };

    await expect(
      store.stageExternalBrowserProjection({
        session: `RemoteAuth-${WORKER_ID}`,
        projection,
        profilePath: '/tmp/wwebjs-external-import-profile',
      })
    ).resolves.toBe('12');

    expect(stageExternalBrowserProjection).toHaveBeenCalledWith({
      projection,
      profilePath: '/tmp/wwebjs-external-import-profile',
    });
    expect(native.logger.log).toHaveBeenCalledWith(
      'secure_import.external_browser_staged',
      expect.objectContaining({
        revision_id: '12',
        record_count: 1,
        size_bytes: 17,
      })
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('persists the canonical Chrome projection on the same fenced candidate', async () => {
    const { pool, query } = createPool();
    const descriptor = activeDescriptor({
      revision_id: '12',
      revision_status: 'staging',
      revision_source: 'secure_import',
    });
    const stageExternalBrowserProjection = jest.fn(async () => '12');
    const persistExternalBrowserBootstrapCanonicalProjection = jest.fn(
      async (projection) => ({
        projection,
        revisionId: '12',
        recordCount: 0,
        sizeBytes: 321,
      })
    );
    const native = createNativeStore(descriptor, {
      stageExternalBrowserProjection,
      persistExternalBrowserBootstrapCanonicalProjection,
    });
    const store = createStore(pool, () => native);
    const browserProjection = {
      schema_version: 2 as const,
      web_version: '2.3000.1027934701',
      complete: true,
      lossy_records: 0,
      size_bytes: 17,
      indexeddb_stores: [],
      records: [],
    };
    const canonicalBrowserProjection = createCanonicalBrowserProjection();

    await expect(
      store.stageExternalCanonicalProjection({
        session: `RemoteAuth-${WORKER_ID}`,
        browserProjection,
        canonicalProjection: canonicalBrowserProjection,
        profilePath: '/tmp/wwebjs-external-canonical-profile',
      })
    ).resolves.toBe('12');

    expect(stageExternalBrowserProjection).toHaveBeenCalledWith({
      projection: browserProjection,
      profilePath: '/tmp/wwebjs-external-canonical-profile',
    });
    expect(
      persistExternalBrowserBootstrapCanonicalProjection
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        schema_version: 17,
        codec_kind: WWEBJS_CANONICAL_CODEC_KIND,
        web_version: canonicalBrowserProjection.web_version,
        device: expect.objectContaining({
          jid: canonicalBrowserProjection.device.jid,
          noise_key: expect.any(Buffer),
        }),
      })
    );
    expect(native.logger.log).toHaveBeenCalledWith(
      'secure_import.external_browser_canonical_projection_staged',
      {
        revision_id: '12',
        record_count: 0,
        size_bytes: 321,
      },
      { force: true }
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('rolls back only the exact secure-import candidate and makes cleanup idempotent', async () => {
    const { pool } = createPool();
    const descriptor = activeDescriptor({
      revision_id: '12',
      revision_status: 'staging',
      revision_source: 'secure_import',
      source_revision_id: '10',
      source_provider: 'wwebjs',
    });
    const native = createNativeStore(descriptor);
    native.stageExternalBrowserProjection = jest.fn(async () => '12');
    native.rollback = jest.fn(async () => {
      native.revisionId = '10';
      native.revisionStatus = 'validating';
      native.revisionSource = 'pairing';
      native.sourceRevisionId = undefined;
      native.sourceProvider = undefined;
      return { revisionId: '10', provider: 'wwebjs' as const };
    });
    const store = createStore(pool, () => native);
    const projection = {
      schema_version: 2 as const,
      web_version: '2.3000.1027934701',
      complete: true,
      lossy_records: 0,
      size_bytes: 17,
      indexeddb_stores: [],
      records: [],
    };

    await store.stageExternalBrowserProjection({
      session: `RemoteAuth-${WORKER_ID}`,
      projection,
      profilePath: '/tmp/wwebjs-external-import-profile',
    });
    await store.failCandidate('wwebjs_secure_import_bootstrap_failed');
    await store.failCandidate('duplicate_cleanup_must_be_ignored');

    expect(native.rollback).toHaveBeenCalledTimes(1);
    expect(native.rollback).toHaveBeenCalledWith(
      'wwebjs_secure_import_bootstrap_failed'
    );
    expect(native.delete).not.toHaveBeenCalled();
  });

  it('does not clear the source pairing revision before a candidate is staged', async () => {
    const { pool } = createPool();
    const native = createNativeStore(
      activeDescriptor({
        revision_status: 'validating',
        revision_source: 'pairing',
      })
    );
    const store = createStore(pool, () => native);
    await store.open();

    await store.failCandidate('import_failed_before_staging');

    expect(native.rollback).not.toHaveBeenCalled();
    expect(native.delete).not.toHaveBeenCalled();
  });

  it('binds a writable legacy profile copy to the empty migration revision', async () => {
    const { pool } = createPool();
    const descriptor = activeDescriptor({
      revision_status: 'staging',
      revision_source: 'legacy_volume_migration',
    });
    const restoreProfile = jest.fn(async () => false);
    const native = createNativeStore(descriptor, { restoreProfile });
    const store = createStore(pool, () => native);

    await expect(
      store.initializeLegacyVolumeCandidateProfile('/tmp/writable-profile')
    ).resolves.toBeUndefined();

    expect(restoreProfile).toHaveBeenCalledWith({
      profilePath: '/tmp/writable-profile',
      selector: 'active',
    });
  });

  it('rejects legacy adoption outside an empty fenced migration candidate', async () => {
    const { pool } = createPool();
    const ordinary = createNativeStore(
      activeDescriptor({ revision_source: 'checkpoint' })
    );
    const ordinaryStore = createStore(pool, () => ordinary);
    await expect(
      ordinaryStore.initializeLegacyVolumeCandidateProfile('/tmp/profile')
    ).rejects.toMatchObject({
      code: 'wwebjs_legacy_volume_revision_not_stageable',
    });
    expect(ordinary.restoreProfile).not.toHaveBeenCalled();

    const legacyDescriptor = activeDescriptor({
      revision_status: 'staging',
      revision_source: 'legacy_volume_migration',
    });
    const nonEmpty = createNativeStore(legacyDescriptor, {
      restoreProfile: jest.fn(async () => true),
    });
    const nonEmptyStore = createStore(pool, () => nonEmpty);
    await expect(
      nonEmptyStore.initializeLegacyVolumeCandidateProfile('/tmp/profile')
    ).rejects.toMatchObject({
      code: 'wwebjs_legacy_volume_candidate_not_empty',
    });
  });

  it('requires the canonical projection for the ready identity preflight', async () => {
    const { pool } = createPool();
    const native = createNativeStore();
    const store = createStore(pool, () => native);
    const options: Parameters<
      WwebjsNativePostgresStore['preflightReadyIdentity']
    >[0] = {
      jid: '5511999999999@c.us',
      canonicalProjection,
    };

    await expect(
      store.getNativeStore().preflightReadyIdentity(options)
    ).resolves.toEqual(
      expect.objectContaining({
        canonicalProjection,
        fingerprintVerified: true,
      })
    );
    expect(native.preflightReadyIdentity).toHaveBeenCalledWith(options);
  });

  it('exposes manager-created handoff metadata without hydrating it in Underchat', async () => {
    const { pool, query } = createPool();
    const descriptor = activeDescriptor({
      revision_id: '11',
      revision_status: 'staging',
      revision_source: 'handoff',
      handoff_id: '019f6f00-0000-7000-8000-000000000003',
      source_revision_id: '10',
      source_provider: 'baileys',
    });
    const native = createNativeStore(descriptor);
    const store = createStore(pool, () => native);

    await expect(store.open()).resolves.toEqual(descriptor);
    expect(store.hasPendingHandoff()).toBe(true);
    expect(store.sourceProvider).toBe('baileys');
    expect(query).not.toHaveBeenCalled();
    expect(native.open).toHaveBeenCalledTimes(1);
  });

  it('detects a target opened directly by RemoteAuth without an adapter descriptor', () => {
    const { pool } = createPool();
    const descriptor = activeDescriptor({
      revision_id: '11',
      revision_status: 'validating',
      revision_source: 'handoff',
      source_revision_id: '10',
      source_provider: 'whatsmeow',
    });
    const native = createNativeStore(descriptor);
    const store = createStore(pool, () => native);

    expect(store.getNativeStore()).toBe(native);
    expect(store.hasPendingHandoff()).toBe(true);
  });

  it('replaces a native store closed directly by RemoteAuth before the next browser attempt', async () => {
    const { pool } = createPool();
    const first = createNativeStore();
    first.close = jest.fn(async () => {
      first.closed = true;
      return true;
    });
    const second = createNativeStore(activeDescriptor({ fencing_token: '42' }));
    const factory = jest
      .fn<WwebjsNativePostgresStore, []>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const store = createStore(pool, factory);

    expect(store.getNativeStore()).toBe(first);
    await first.close();
    expect(store.getNativeStore()).toBe(second);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('rejects ambiguous RemoteAuth names and contains no duplicated DB codec', async () => {
    const { pool } = createPool();
    const store = createStore(pool, () => createNativeStore());
    const error = await store
      .sessionExists({ session: `/tmp/profile/RemoteAuth-${WORKER_ID}` })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(WwebjsPostgresSessionError);
    expect((error as WwebjsPostgresSessionError).code).toBe(
      'wwebjs_postgres_session_name_mismatch'
    );

    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'packages/services/wwebjs/methods/postgresSessionStore.ts'
      ),
      'utf8'
    );
    expect(source).not.toContain('begin_whatsapp_handoff_source_read');
    expect(source).not.toContain('begin_whatsapp_session_operation');
    expect(source).not.toContain('whatsapp_signal_sessions');
    expect(source).not.toContain('wwebjs_cross_provider_codec_unavailable');
    expect(source).not.toContain('createHash(');
  });
});
