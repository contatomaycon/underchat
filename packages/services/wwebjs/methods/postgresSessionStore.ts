import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import whatsappWeb from '@wwebjs/whatsapp-web.js';
import {
  canonicalBrowserProjectionToStore,
  normalizeCanonicalProjection,
  type WwebjsCanonicalBrowserProjection,
} from '@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js';
import { getWorkerPostgresPool } from '@core/services/workerPostgresPool';

export const WWEBJS_NATIVE_SESSION_KIND = 'whatsapp-postgres-v1' as const;
/**
 * The version bundled with the installed package. It is retained only for
 * legacy-volume clients. PostgreSQL sessions use the live page version and
 * bind window.Debug.VERSION after the private-module ABI preflight.
 */
export const WWEBJS_SUPPORTED_WEB_VERSION = whatsappWeb.SupportedWebVersion;
export const WWEBJS_COMPANION_FINGERPRINT_VERSION =
  'underchat-whatsapp-device-fingerprint-v2' as const;
export const WWEBJS_PRIVATE_MODULE_ABI = 'wwebjs-private-modules-v1' as const;
export const WWEBJS_CANONICAL_CODEC_KIND =
  'wwebjs-canonical-session-v1' as const;
export const WWEBJS_LIFECYCLE_CAPABILITIES = [
  'active-canonical-replay-v1',
  'two-phase-activation-v1',
  'fenced-browser-termination-v1',
  'canonical-pq-ml-kem-1024-v1',
  'pq-upload-rollback-fence-v1',
  'profile-anchor-canonical-checkpoint-v1',
] as const;
// Keep the adapter ceiling aligned with the native store/database restore
// boundary. A valid WhatsApp Web IndexedDB snapshot can legitimately exceed
// 256 MiB, and rejecting it here strands a pre-drain provider handoff even
// though the persisted artifact path safely supports 512 MiB.
export const WWEBJS_SESSION_MAX_BYTES = 512 * 1024 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_BIGINT_PATTERN = /^[1-9][0-9]*$/;

type WwebjsProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

export interface WwebjsSessionPool {
  connect(): ReturnType<Pool['connect']>;
  query: Pool['query'];
}

export interface WwebjsNativeSessionDescriptor {
  session_id: string;
  revision_id: string;
  revision_status?: string;
  revision_source?: string;
  handoff_id?: string;
  source_revision_id?: string;
  source_provider?: WwebjsProvider;
  provider: 'wwebjs';
  generation: number;
  epoch: string;
  fencing_token: string;
  web_version: string;
}

interface WwebjsNativeDebugLogger {
  revisionId?: string;
  log(
    event: string,
    fields?: Record<string, unknown>,
    options?: { force?: boolean }
  ): void;
}

export interface WwebjsBrowserProjection {
  schema_version: 2;
  web_version: string;
  complete: boolean;
  records: Array<Record<string, unknown>>;
  indexeddb_stores: Array<Record<string, unknown>>;
  lossy_records?: number;
  size_bytes?: number;
}

interface WwebjsCanonicalProjection extends Record<string, unknown> {
  schema_version: 17;
  codec_kind: typeof WWEBJS_CANONICAL_CODEC_KIND;
  codec_version: 1;
  module_abi: typeof WWEBJS_PRIVATE_MODULE_ABI;
  fingerprint_version: typeof WWEBJS_COMPANION_FINGERPRINT_VERSION;
  complete: true;
}

interface WwebjsSessionProjection {
  format_version: 'whatsapp-session-v1';
  source_provider: WwebjsProvider;
  session_id: string;
  revision_id: string;
  web_version?: string;
  identity?: {
    jid: string;
    device_fingerprint: string;
  };
  provider_projection?: WwebjsBrowserProjection;
  canonicalProjection?: WwebjsCanonicalProjection;
  artifact?: {
    artifact_id?: string;
    manifest?: Record<string, unknown>;
    checksum_sha256: string;
    size_bytes: number;
  };
}

export interface WwebjsNativePostgresStore {
  readonly kind: typeof WWEBJS_NATIVE_SESSION_KIND;
  readonly provider: 'wwebjs';
  readonly sessionId: string;
  webVersion: string;
  readonly webVersionIntegrityPinned: boolean;
  revisionId?: string;
  revisionStatus?: string;
  revisionSource?: string;
  sourceRevisionId?: string;
  sourceProvider?: WwebjsProvider;
  /** True only after the native store's terminal close/release completed. */
  closed?: boolean;
  logger: WwebjsNativeDebugLogger;
  open(options?: {
    onLeaseLost?: (error: Error) => void | Promise<void>;
  }): Promise<WwebjsNativeSessionDescriptor>;
  describe(): WwebjsNativeSessionDescriptor;
  bindRuntimeWebVersion(webVersion: string, moduleAbi: string): string;
  renewLease(): Promise<void>;
  assertLocalLease(): void;
  releaseLease(): Promise<boolean>;
  restoreProfile(options: {
    profilePath: string;
    selector?: 'active' | 'previous';
  }): Promise<boolean>;
  checkpointProfile(options: {
    profilePath: string;
    projection?: WwebjsBrowserProjection;
    canonicalProjection?: WwebjsCanonicalProjection;
    source?: string;
    promote?: boolean;
  }): Promise<Record<string, unknown>>;
  consumePendingProjection(): Promise<WwebjsBrowserProjection | undefined>;
  consumePendingCanonicalProjection(): Promise<
    WwebjsCanonicalProjection | undefined
  >;
  stageExternalBrowserProjection(options: {
    projection: WwebjsBrowserProjection;
    profilePath: string;
  }): Promise<string>;
  persistExternalBrowserBootstrapCanonicalProjection(
    projection: WwebjsCanonicalProjection
  ): Promise<{
    projection: WwebjsCanonicalProjection;
    revisionId: string;
    recordCount: number;
    sizeBytes: number;
  }>;
  loadCanonicalProjection(options?: {
    revisionId?: string;
  }): Promise<WwebjsCanonicalProjection | undefined>;
  loadCanonicalRestartAuthority(): Promise<{
    projection: WwebjsCanonicalProjection;
    appStateOverlayRequired: boolean;
    canonicalGeneration?: string;
    profileArtifactId?: string;
    legacy: boolean;
  }>;
  saveCanonicalProjection(options: {
    projection: WwebjsCanonicalProjection;
    source?: string;
  }): Promise<Record<string, unknown>>;
  saveCanonicalProviderState(state: Record<string, unknown>): Promise<unknown>;
  preflightReadyIdentity(options: {
    jid: string;
    companionFingerprint?: string | Buffer | Uint8Array;
    canonicalProjection: WwebjsCanonicalProjection;
  }): Promise<{
    canonicalProjection: WwebjsCanonicalProjection;
    browserJid: string;
    projectedJid: string;
    projectedFingerprint: Buffer;
    trustedFingerprint?: Buffer;
    databaseJidPresent: boolean;
    fingerprintVerified: boolean;
  }>;
  validateReadyIdentity(options: {
    jid: string;
    companionFingerprint?: string | Buffer | Uint8Array;
  }): Promise<Record<string, unknown>>;
  importProjection(options: {
    projection: WwebjsSessionProjection;
    profilePath?: string;
    promote?: boolean;
  }): Promise<string>;
  exportProjection(): Promise<WwebjsSessionProjection>;
  prepareHandoff(
    targetProvider: Exclude<WwebjsProvider, 'wwebjs'>,
    options?: {
      profilePath?: string;
      projection?: WwebjsBrowserProjection;
      handoffId?: string;
      lifecycleOperationId?: string;
      sourceRevisionId?: string;
    }
  ): Promise<Record<string, unknown>>;
  assertAuthorizedHandoff(
    targetProvider: Exclude<WwebjsProvider, 'wwebjs'>,
    expected?: { handoffId?: string; lifecycleOperationId?: string }
  ): Promise<Record<string, unknown>>;
  isHandoffRevision(): boolean;
  isPairingAllowed(): Promise<boolean>;
  requiresNoiseMetadataBootstrap(): boolean;
  markCanonicalActivationPending(options?: {
    appStateHydrationRequired?: boolean;
    pqBootstrapRequired?: boolean;
    readyCheckpointArtifactId?: string | null;
    readyCheckpointChecksumSha256?: string | null;
  }): Promise<void>;
  loadPendingCanonicalActivation(): Promise<
    Record<string, unknown> | undefined
  >;
  promote(revisionId?: string): Promise<Record<string, unknown>>;
  commitActivation(revisionId?: string): Promise<Record<string, unknown>>;
  finalizeActivation(revisionId?: string): Promise<Record<string, unknown>>;
  rollback(errorCode?: string): Promise<{
    revisionId: string;
    provider?: WwebjsProvider;
  }>;
  delete(): Promise<void>;
  close(options?: { requireLeaseRelease?: boolean }): Promise<boolean>;
}

export interface WwebjsNativePostgresStoreOptions {
  pool: WwebjsSessionPool;
  sessionId: string;
  revisionId?: string;
  ownerId: string;
  generation: number;
  epoch: string;
  /** Raw 32..512 character capability. Pass only as a bound SQL parameter. */
  runtimeCapability: string;
  revisionSource?: 'pairing' | 'legacy_volume_migration';
  storageMigrationId?: string;
  /** Live/latest is the PostgreSQL default; literal version pinning is opt-in. */
  webVersionIntegrityPinned: false;
  debugEnabled: boolean;
  maxProfileBytes: number;
}

export type WwebjsNativePostgresStoreFactory = (
  options: WwebjsNativePostgresStoreOptions
) => WwebjsNativePostgresStore;

export interface WwebjsCanonicalCompanionIdentity {
  jid: string;
  companionFingerprint: string;
  fingerprintVersion: typeof WWEBJS_COMPANION_FINGERPRINT_VERSION;
  moduleAbi: typeof WWEBJS_PRIVATE_MODULE_ABI;
  webVersion: string;
}

export async function resolveWwebjsCanonicalCompanionIdentity(
  client: unknown
): Promise<WwebjsCanonicalCompanionIdentity> {
  const resolver = (client as { getCompanionIdentity?: () => Promise<unknown> })
    ?.getCompanionIdentity;
  if (typeof resolver !== 'function') {
    throw new WwebjsPostgresSessionError(
      'wwebjs_companion_identity_api_unavailable'
    );
  }

  const identity = await resolver.call(client);
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new WwebjsPostgresSessionError('wwebjs_companion_identity_invalid');
  }
  const value = identity as Record<string, unknown>;
  if (
    typeof value.jid !== 'string' ||
    value.jid !== value.jid.trim() ||
    value.jid.length === 0 ||
    value.jid.length > 255 ||
    !/^[^@\s]+@(c\.us|s\.whatsapp\.net|lid)$/i.test(value.jid) ||
    typeof value.companionFingerprint !== 'string' ||
    !SHA256_PATTERN.test(value.companionFingerprint) ||
    value.fingerprintVersion !== WWEBJS_COMPANION_FINGERPRINT_VERSION ||
    value.moduleAbi !== WWEBJS_PRIVATE_MODULE_ABI ||
    typeof value.webVersion !== 'string' ||
    value.webVersion.length === 0 ||
    value.webVersion.length > 100
  ) {
    throw new WwebjsPostgresSessionError('wwebjs_companion_identity_invalid');
  }
  return {
    jid: value.jid,
    companionFingerprint: value.companionFingerprint,
    fingerprintVersion: WWEBJS_COMPANION_FINGERPRINT_VERSION,
    moduleAbi: WWEBJS_PRIVATE_MODULE_ABI,
    webVersion: value.webVersion,
  };
}

export interface PostgresWwebjsSessionStoreOptions {
  pool: WwebjsSessionPool;
  workerId: string;
  writerGeneration: number;
  writerEpoch: string;
  /** Raw 32..512 character capability. Never log or pre-hash it. */
  runtimeCapability: string;
  revisionId?: string;
  maxProfileBytes?: number;
  debugEnabled?: boolean;
  nativeStoreFactory?: WwebjsNativePostgresStoreFactory;
}

export class WwebjsPostgresSessionError extends Error {
  constructor(
    public readonly code: string,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'WwebjsPostgresSessionError';
  }
}

const assertCanonicalAbi = (value: unknown): void => {
  const abi = value as Record<string, unknown> | undefined;
  if (
    !abi ||
    abi.schemaVersion !== 17 ||
    abi.codecKind !== WWEBJS_CANONICAL_CODEC_KIND ||
    abi.codecVersion !== 1 ||
    abi.moduleAbi !== WWEBJS_PRIVATE_MODULE_ABI ||
    abi.fingerprintVersion !== WWEBJS_COMPANION_FINGERPRINT_VERSION ||
    !Array.isArray(abi.signalScopes) ||
    abi.signalScopes.join(',') !== 'default,status,pq' ||
    !Array.isArray(abi.lifecycleCapabilities) ||
    abi.lifecycleCapabilities.join(',') !==
      WWEBJS_LIFECYCLE_CAPABILITIES.join(',')
  ) {
    throw new WwebjsPostgresSessionError(
      'wwebjs_native_postgres_session_codec_incompatible'
    );
  }
};

export function resolveWwebjsNativePostgresStoreFactory(
  moduleValue: unknown = whatsappWeb
): WwebjsNativePostgresStoreFactory {
  const nativeModule = moduleValue as {
    PostgresSessionStore?: new (
      options: WwebjsNativePostgresStoreOptions
    ) => WwebjsNativePostgresStore;
    CANONICAL_SESSION_STORE_ABI?: unknown;
    Client?: { prototype?: { getCompanionIdentity?: unknown } };
  };
  if (typeof nativeModule.PostgresSessionStore !== 'function') {
    throw new WwebjsPostgresSessionError(
      'wwebjs_native_postgres_session_api_unavailable'
    );
  }
  assertCanonicalAbi(nativeModule.CANONICAL_SESSION_STORE_ABI);

  const Store = nativeModule.PostgresSessionStore;
  const requiredStoreMethods = [
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
  ];
  if (
    requiredStoreMethods.some(
      (method) =>
        typeof (Store.prototype as unknown as Record<string, unknown>)[
          method
        ] !== 'function'
    ) ||
    typeof nativeModule.Client?.prototype?.getCompanionIdentity !== 'function'
  ) {
    throw new WwebjsPostgresSessionError(
      'wwebjs_native_postgres_session_api_incomplete'
    );
  }
  return (options) => new Store(options);
}

const safeErrorCode = (error: unknown): string => {
  if (error instanceof WwebjsPostgresSessionError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code).slice(0, 100);
  }
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 100);
  }
  return 'wwebjs_session_operation_failed';
};

/**
 * Underchat lifecycle adapter. All lease, SQL, canonical codecs, profile
 * streaming, fingerprinting, and handoff materialization live in WWebJS.
 */
export class PostgresWwebjsSessionStore {
  readonly kind = WWEBJS_NATIVE_SESSION_KIND;
  readonly provider = 'wwebjs' as const;
  readonly sessionId: string;

  private readonly pool: WwebjsSessionPool;
  private readonly writerGeneration: number;
  private readonly writerEpoch: string;
  private readonly runtimeCapability!: string;
  private readonly requestedRevisionId: string | undefined;
  private readonly ownerId = randomUUID();
  private readonly sessionName: string;
  private readonly maxProfileBytes: number;
  private readonly debugEnabled: boolean;
  private readonly nativeStoreFactory: WwebjsNativePostgresStoreFactory;
  private nativeStore: WwebjsNativePostgresStore | undefined;
  private descriptor: WwebjsNativeSessionDescriptor | undefined;
  private stagedSecureImportRevisionId: string | undefined;
  private onLeaseLost: ((error: Error) => void | Promise<void>) | undefined;

  constructor(options: PostgresWwebjsSessionStoreOptions) {
    if (!UUID_PATTERN.test(options.workerId)) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_postgres_session_worker_id_invalid'
      );
    }
    if (!UUID_PATTERN.test(options.writerEpoch)) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_postgres_session_writer_epoch_invalid'
      );
    }
    if (
      !Number.isSafeInteger(options.writerGeneration) ||
      options.writerGeneration <= 0
    ) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_postgres_session_generation_invalid'
      );
    }
    if (
      typeof options.runtimeCapability !== 'string' ||
      options.runtimeCapability.length < 32 ||
      options.runtimeCapability.length > 512
    ) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_postgres_session_capability_invalid'
      );
    }

    this.pool = options.pool;
    this.sessionId = options.workerId;
    this.writerGeneration = options.writerGeneration;
    this.writerEpoch = options.writerEpoch;
    Object.defineProperty(this, 'runtimeCapability', {
      value: options.runtimeCapability,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    this.requestedRevisionId = options.revisionId;
    this.sessionName = `RemoteAuth-${options.workerId}`;
    this.maxProfileBytes = Math.min(
      Math.max(1, options.maxProfileBytes ?? WWEBJS_SESSION_MAX_BYTES),
      WWEBJS_SESSION_MAX_BYTES
    );
    this.debugEnabled = options.debugEnabled ?? true;
    this.nativeStoreFactory =
      options.nativeStoreFactory ?? resolveWwebjsNativePostgresStoreFactory();
  }

  get webVersion(): string {
    return this.nativeStore?.webVersion ?? WWEBJS_SUPPORTED_WEB_VERSION;
  }

  get webVersionIntegrityPinned(): false {
    return false;
  }

  get revisionId(): string | undefined {
    return this.nativeStore?.revisionId ?? this.descriptor?.revision_id;
  }

  get revisionStatus(): string | undefined {
    return this.nativeStore?.revisionStatus ?? this.descriptor?.revision_status;
  }

  get revisionSource(): string | undefined {
    return this.nativeStore?.revisionSource ?? this.descriptor?.revision_source;
  }

  get sourceRevisionId(): string | undefined {
    return (
      this.nativeStore?.sourceRevisionId ?? this.descriptor?.source_revision_id
    );
  }

  get sourceProvider(): WwebjsProvider | undefined {
    return this.nativeStore?.sourceProvider ?? this.descriptor?.source_provider;
  }

  get logger(): WwebjsNativeDebugLogger {
    return this.getNativeStore().logger;
  }

  /** The exact native instance consumed by RemoteAuth. */
  getNativeStore(): WwebjsNativePostgresStore {
    // RemoteAuth closes the native instance directly. A later Chromium retry
    // reuses this adapter, so discard only a terminally closed store and let a
    // fresh instance acquire a new fencing token. Failed/unconfirmed closes
    // remain fail-closed and are intentionally retained.
    if (this.nativeStore?.closed === true) {
      this.nativeStore = undefined;
      this.descriptor = undefined;
    }
    this.nativeStore ??= this.nativeStoreFactory({
      pool: this.pool,
      sessionId: this.sessionId,
      revisionId: this.requestedRevisionId,
      ownerId: this.ownerId,
      generation: this.writerGeneration,
      epoch: this.writerEpoch,
      runtimeCapability: this.runtimeCapability,
      ...(process.env.SESSION_STORAGE_MIGRATION_ID?.trim()
        ? {
            revisionSource: 'legacy_volume_migration' as const,
            storageMigrationId: process.env.SESSION_STORAGE_MIGRATION_ID.trim(),
          }
        : {}),
      webVersionIntegrityPinned: false,
      debugEnabled: this.debugEnabled,
      maxProfileBytes: this.maxProfileBytes,
    });
    return this.nativeStore;
  }

  async open(
    options: {
      onLeaseLost?: (error: Error) => void | Promise<void>;
    } = {}
  ): Promise<WwebjsNativeSessionDescriptor> {
    if (options.onLeaseLost) this.onLeaseLost = options.onLeaseLost;
    const store = this.getNativeStore();
    const descriptor = await store.open({
      onLeaseLost: async (error) => {
        if (this.nativeStore !== store) return;
        store.logger.log(
          'lease.lost',
          { error_code: safeErrorCode(error) },
          { force: true }
        );
        await this.onLeaseLost?.(error);
      },
    });
    this.descriptor = descriptor;
    return store.describe();
  }

  setLeaseLostHandler(handler: (error: Error) => void | Promise<void>): void {
    this.onLeaseLost = handler;
  }

  describe(): WwebjsNativeSessionDescriptor {
    return this.getNativeStore().describe();
  }

  getConnectionStatusLeaseProof():
    { ownerId: string; fencingToken: string } | undefined {
    if (!this.nativeStore) return undefined;
    try {
      this.nativeStore.assertLocalLease();
      const descriptor = this.nativeStore.describe();
      if (
        descriptor.session_id !== this.sessionId ||
        !UUID_PATTERN.test(this.ownerId) ||
        !POSITIVE_BIGINT_PATTERN.test(descriptor.fencing_token)
      ) {
        return undefined;
      }
      return {
        ownerId: this.ownerId,
        fencingToken: descriptor.fencing_token,
      };
    } catch {
      return undefined;
    }
  }

  async sessionExists(input: { session: string }): Promise<boolean> {
    this.assertSessionName(input.session);
    const descriptor = await this.open();
    const storageMigrationId =
      process.env.SESSION_STORAGE_MIGRATION_ID?.trim() ?? '';
    const resumableLegacyVolumeCandidate =
      descriptor.revision_status === 'validating' &&
      descriptor.revision_source === 'legacy_volume_migration' &&
      UUID_PATTERN.test(storageMigrationId);
    return (
      descriptor.revision_status === 'active' ||
      Boolean(descriptor.handoff_id) ||
      resumableLegacyVolumeCandidate
    );
  }

  async stageCandidate(input: {
    session: string;
    profilePath: string;
  }): Promise<string> {
    this.assertSessionName(input.session);
    await this.open();
    const store = this.getNativeStore();
    const projection: WwebjsSessionProjection = {
      format_version: 'whatsapp-session-v1',
      source_provider: 'wwebjs',
      session_id: this.sessionId,
      revision_id: store.revisionId ?? '0',
      web_version: store.webVersion,
    };

    let revisionId: string;
    if (store.revisionStatus === 'active') {
      revisionId = await store.importProjection({
        projection,
        profilePath: input.profilePath,
        promote: false,
      });
    } else if (
      store.revisionStatus === 'staging' &&
      ['pairing', 'legacy_volume_migration'].includes(
        store.revisionSource ?? ''
      )
    ) {
      const source =
        store.revisionSource === 'legacy_volume_migration'
          ? 'legacy_volume_migration'
          : 'pairing';
      await store.checkpointProfile({
        profilePath: input.profilePath,
        source,
        promote: false,
      });
      revisionId = store.revisionId ?? '';
    } else {
      throw new WwebjsPostgresSessionError(
        'wwebjs_secure_import_revision_not_stageable'
      );
    }
    if (!revisionId) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_secure_import_revision_missing'
      );
    }
    this.descriptor = store.describe();
    this.stagedSecureImportRevisionId = revisionId;
    store.logger.log('secure_import.staged', { revision_id: revisionId });
    return revisionId;
  }

  async stageExternalBrowserProjection(input: {
    session: string;
    projection: WwebjsBrowserProjection;
    profilePath: string;
  }): Promise<string> {
    this.assertSessionName(input.session);
    await this.open();
    const store = this.getNativeStore();
    const revisionId = await store.stageExternalBrowserProjection({
      projection: input.projection,
      profilePath: input.profilePath,
    });
    if (!revisionId) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_secure_import_revision_missing'
      );
    }
    this.descriptor = store.describe();
    this.stagedSecureImportRevisionId = revisionId;
    store.logger.log('secure_import.external_browser_staged', {
      revision_id: revisionId,
      record_count: input.projection.records.length,
      size_bytes: input.projection.size_bytes,
    });
    return revisionId;
  }

  async stageExternalCanonicalProjection(input: {
    session: string;
    browserProjection: WwebjsBrowserProjection;
    canonicalProjection: WwebjsCanonicalBrowserProjection;
    profilePath: string;
  }): Promise<string> {
    const revisionId = await this.stageExternalBrowserProjection({
      session: input.session,
      projection: input.browserProjection,
      profilePath: input.profilePath,
    });
    const canonicalProjection = canonicalBrowserProjectionToStore(
      normalizeCanonicalProjection(input.canonicalProjection)
    ) as WwebjsCanonicalProjection;
    const store = this.getNativeStore();
    const persisted =
      await store.persistExternalBrowserBootstrapCanonicalProjection(
        canonicalProjection
      );
    store.logger.log(
      'secure_import.external_browser_canonical_projection_staged',
      {
        revision_id: revisionId,
        record_count: persisted.recordCount,
        size_bytes: persisted.sizeBytes,
      },
      { force: true }
    );
    return revisionId;
  }

  /**
   * Creates the revision-bound ownership marker in a writable copy of a
   * retired legacy profile. The native store must report an empty candidate;
   * restoring an existing artifact here would mix two migration authorities.
   */
  async initializeLegacyVolumeCandidateProfile(
    profilePath: string
  ): Promise<void> {
    await this.open();
    const store = this.getNativeStore();
    if (
      store.revisionStatus !== 'staging' ||
      store.revisionSource !== 'legacy_volume_migration'
    ) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_legacy_volume_revision_not_stageable'
      );
    }
    const restored = await store.restoreProfile({
      profilePath,
      selector: 'active',
    });
    if (restored !== false) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_legacy_volume_candidate_not_empty'
      );
    }
    this.descriptor = store.describe();
  }

  async failCandidate(
    errorCode = 'secure_import_validation_failed'
  ): Promise<void> {
    const store = this.nativeStore;
    const stagedRevisionId = this.stagedSecureImportRevisionId;
    if (!store || !stagedRevisionId) return;

    if (store.revisionId !== stagedRevisionId) {
      this.stagedSecureImportRevisionId = undefined;
      this.descriptor = store.describe();
      return;
    }

    if (store.isHandoffRevision() && this.sourceRevisionId) {
      await store.rollback(errorCode);
    } else if (store.revisionStatus !== 'active') {
      await store.delete();
    }
    this.stagedSecureImportRevisionId = undefined;
    this.descriptor = store.describe();
  }

  exportProjection(): Promise<WwebjsSessionProjection> {
    return this.getNativeStore().exportProjection();
  }

  prepareHandoff(
    targetProvider: Exclude<WwebjsProvider, 'wwebjs'>,
    options?: {
      profilePath?: string;
      projection?: WwebjsBrowserProjection;
      handoffId?: string;
      lifecycleOperationId?: string;
      sourceRevisionId?: string;
    }
  ): Promise<Record<string, unknown>> {
    return this.getNativeStore().prepareHandoff(targetProvider, options);
  }

  hasPendingHandoff(): boolean {
    // RemoteAuth opens the exact native instance directly, so the adapter's
    // cached descriptor may legitimately be unset. Native revision context is
    // the source of truth after startup.
    return (
      this.revisionSource === 'handoff' &&
      Boolean(this.sourceRevisionId) &&
      (this.sourceProvider === 'baileys' ||
        this.sourceProvider === 'whatsmeow' ||
        this.sourceProvider === 'wwebjs')
    );
  }

  isHandoffRevision(): boolean {
    return this.nativeStore?.isHandoffRevision() === true;
  }

  async delete(): Promise<void> {
    if (!this.nativeStore) await this.open();
    await this.getNativeStore().delete();
    this.descriptor = undefined;
  }

  async close(options?: { requireLeaseRelease?: boolean }): Promise<boolean> {
    if (!this.nativeStore) return true;
    const released = await this.nativeStore.close(options);
    if (options?.requireLeaseRelease === true && released !== true) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_native_lease_release_unconfirmed'
      );
    }
    if (released) {
      this.nativeStore = undefined;
      this.descriptor = undefined;
    }
    return released;
  }

  private assertSessionName(session: string): void {
    if (session !== this.sessionName) {
      throw new WwebjsPostgresSessionError(
        'wwebjs_postgres_session_name_mismatch'
      );
    }
  }
}

export function createPostgresWwebjsSessionStoreFromEnvironment(
  workerId: string,
  pool: WwebjsSessionPool = getWorkerPostgresPool(),
  nativeStoreFactory?: WwebjsNativePostgresStoreFactory
): PostgresWwebjsSessionStore {
  return new PostgresWwebjsSessionStore({
    pool,
    workerId,
    writerGeneration: Number(process.env.RUNTIME_GENERATION),
    writerEpoch: process.env.WORKER_WRITER_EPOCH?.trim() ?? '',
    runtimeCapability: process.env.WORKER_RUNTIME_CAPABILITY?.trim() ?? '',
    debugEnabled:
      process.env.WHATSAPP_SESSION_DEBUG_ENABLED?.trim().toLowerCase() !==
      'false',
    nativeStoreFactory,
  });
}
