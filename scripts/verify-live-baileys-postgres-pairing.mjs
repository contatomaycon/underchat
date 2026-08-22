#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import pg from 'pg';
import QRCode from 'qrcode';

import {
  closeBaileysSocket,
  createCredsPersistenceQueue,
  quiesceBaileysForHandoff,
} from './lib/baileys-live-pairing-lifecycle.mjs';

const { Pool } = pg;

const SCHEMA_VERSION = 17;
const BAILEYS_WORKER_TYPE = '019a930d-c6f6-766d-9c84-53307d4159a1';
const RECREATING_WORKER_STATUS = '019a930d-c6f6-766d-9c84-46093814d8e0';
const DEFAULT_BAILEYS_ENTRY = '/home/maycon/baileys/lib/index.js';
const PAIRING_TIMEOUT_MS = 5 * 60 * 1000;
const READY_GATE_TIMEOUT_MS = 5 * 60 * 1000;

const env = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
};

const requireUuid = (name, value) => {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
    `${name}_invalid`
  );
  return value;
};

const log = (stage, fields = {}) => {
  process.stdout.write(
    `${JSON.stringify({
      prefix: '[baileys-live-postgres-pairing]',
      stage,
      ...fields,
    })}\n`
  );
};

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const capabilityHash = (capability) =>
  crypto.createHash('sha256').update(capability, 'utf8').digest('hex');

// worker.name is varchar(50); keep this deterministic marker well below it.
const fixtureMarker = (sessionId) => `wa-bcanary-${sessionId.slice(0, 8)}`;

const config = () => {
  const sessionId = requireUuid(
    'BAILEYS_CANARY_SESSION_ID',
    process.env.BAILEYS_CANARY_SESSION_ID?.trim() || crypto.randomUUID()
  );
  return {
    action: process.argv[2] || 'pair',
    adminDatabaseUrl: env('BAILEYS_CANARY_ADMIN_DATABASE_URL'),
    runtimeDatabaseUrl: env('BAILEYS_CANARY_RUNTIME_DATABASE_URL'),
    accountId: requireUuid(
      'BAILEYS_CANARY_ACCOUNT_ID',
      env('BAILEYS_CANARY_ACCOUNT_ID')
    ),
    sessionId,
    ownerId: requireUuid(
      'BAILEYS_CANARY_OWNER_ID',
      process.env.BAILEYS_CANARY_OWNER_ID?.trim() || crypto.randomUUID()
    ),
    epoch: requireUuid(
      'BAILEYS_CANARY_EPOCH',
      process.env.BAILEYS_CANARY_EPOCH?.trim() || crypto.randomUUID()
    ),
    lifecycleOperationId: requireUuid(
      'BAILEYS_CANARY_LIFECYCLE_OPERATION_ID',
      process.env.BAILEYS_CANARY_LIFECYCLE_OPERATION_ID?.trim() ||
        crypto.randomUUID()
    ),
    runtimeConnectionEpoch: requireUuid(
      'BAILEYS_CANARY_RUNTIME_CONNECTION_EPOCH',
      process.env.BAILEYS_CANARY_RUNTIME_CONNECTION_EPOCH?.trim() ||
        crypto.randomUUID()
    ),
    capability:
      process.env.BAILEYS_CANARY_RUNTIME_CAPABILITY?.trim() ||
      crypto.randomBytes(48).toString('base64url'),
    baileysEntry:
      process.env.BAILEYS_CANARY_LIBRARY_ENTRY?.trim() || DEFAULT_BAILEYS_ENTRY,
    artifactDirectory: process.env.BAILEYS_CANARY_ARTIFACT_DIRECTORY?.trim(),
  };
};

const silentLogger = {
  level: 'silent',
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  child() {
    return silentLogger;
  },
};

const createArtifacts = async (settings) => {
  const directory = settings.artifactDirectory
    ? path.resolve(settings.artifactDirectory)
    : await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'underchat-baileys-canary-')
      );
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(directory, 0o700);
  const statePath = path.join(directory, 'fixture-state.json');
  const qrPath = path.join(directory, 'pairing-qr.png');
  await fs.promises.writeFile(
    statePath,
    `${JSON.stringify({
      session_id: settings.sessionId,
      account_id: settings.accountId,
      owner_id: settings.ownerId,
      epoch: settings.epoch,
      lifecycle_operation_id: settings.lifecycleOperationId,
      runtime_connection_epoch: settings.runtimeConnectionEpoch,
      runtime_capability: settings.capability,
      marker: fixtureMarker(settings.sessionId),
    })}\n`,
    { mode: 0o600, flag: 'wx' }
  );
  await fs.promises.chmod(statePath, 0o600);
  return { directory, statePath, qrPath };
};

const loadArtifacts = async (settings) => {
  if (!settings.artifactDirectory) {
    throw new Error('baileys_canary_artifact_directory_required');
  }
  const directory = path.resolve(settings.artifactDirectory);
  const statePath = path.join(directory, 'fixture-state.json');
  const qrPath = path.join(directory, 'pairing-qr.png');
  const [directoryStat, stateStat, statePayload] = await Promise.all([
    fs.promises.stat(directory),
    fs.promises.stat(statePath),
    fs.promises.readFile(statePath, 'utf8'),
  ]);
  if (
    !directoryStat.isDirectory() ||
    (directoryStat.mode & 0o077) !== 0 ||
    !stateStat.isFile() ||
    (stateStat.mode & 0o077) !== 0
  ) {
    throw new Error('baileys_canary_artifact_permissions_invalid');
  }
  let state;
  try {
    state = JSON.parse(statePayload);
  } catch {
    throw new Error('baileys_canary_artifact_state_invalid');
  }
  if (
    state?.session_id !== settings.sessionId ||
    state?.account_id !== settings.accountId ||
    state?.owner_id !== settings.ownerId ||
    state?.epoch !== settings.epoch ||
    state?.lifecycle_operation_id !== settings.lifecycleOperationId ||
    (state?.runtime_connection_epoch !== undefined &&
      state.runtime_connection_epoch !== settings.runtimeConnectionEpoch) ||
    state?.runtime_capability !== settings.capability ||
    state?.marker !== fixtureMarker(settings.sessionId)
  ) {
    throw new Error('baileys_canary_artifact_state_mismatch');
  }
  return { directory, statePath, qrPath };
};

const bootstrapFixture = async (settings) => {
  const pool = new Pool({ connectionString: settings.adminDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const version = await client.query(
      'SELECT version, compat FROM public.whatsapp_store_version'
    );
    assert.deepEqual(version.rows, [
      { version: SCHEMA_VERSION, compat: SCHEMA_VERSION },
    ]);
    const account = await client.query(
      'SELECT 1 FROM public.account WHERE account_id = $1::uuid',
      [settings.accountId]
    );
    assert.equal(account.rowCount, 1, 'baileys_canary_account_missing');
    const existing = await client.query(
      `SELECT 1
         FROM public.worker
        WHERE worker_id = $1::uuid
           OR name = $2`,
      [settings.sessionId, fixtureMarker(settings.sessionId)]
    );
    assert.equal(existing.rowCount, 0, 'baileys_canary_fixture_exists');
    await client.query(
      `INSERT INTO public.worker (
           worker_id, worker_status_id, worker_type_id, account_id,
           name, lifecycle_operation_id, session_storage
       ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid,
           $5, $6::uuid, 'postgres'
       )`,
      [
        settings.sessionId,
        RECREATING_WORKER_STATUS,
        BAILEYS_WORKER_TYPE,
        settings.accountId,
        fixtureMarker(settings.sessionId),
        settings.lifecycleOperationId,
      ]
    );
    await client.query(
      `INSERT INTO public.worker_runtime (
           worker_id, container_id, container_name, runtime_generation,
           connection_epoch, connection_sequence, source_provider,
           connection_activated_at, session_storage,
           runtime_capability_hash, session_writer_epoch, activated_at
       ) VALUES (
           $1::uuid, $2, $3, 1, $4::uuid, 1, 'baileys',
           clock_timestamp(), 'postgres', $5, $6::uuid, clock_timestamp()
       )`,
      [
        settings.sessionId,
        capabilityHash(`container:${settings.sessionId}`),
        fixtureMarker(settings.sessionId),
        settings.runtimeConnectionEpoch,
        capabilityHash(settings.capability),
        settings.epoch,
      ]
    );
    await client.query(
      `INSERT INTO public.whatsapp_session (
           session_id, provider, state, generation, epoch, capability_hash
       ) VALUES (
           $1::uuid, 'baileys', 'empty', 1, $2::uuid, $3
       )`,
      [settings.sessionId, settings.epoch, capabilityHash(settings.capability)]
    );
    const lease = await client.query(
      `SELECT owner_id IS NULL AS released
         FROM public.whatsapp_session_lease
        WHERE session_id = $1::uuid`,
      [settings.sessionId]
    );
    assert.deepEqual(lease.rows, [{ released: true }]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

const inspectFixture = async (settings, { requireReady = false } = {}) => {
  const pool = new Pool({ connectionString: settings.adminDatabaseUrl });
  try {
    const result = await pool.query(
      `SELECT session.state,
              session.provider,
              revision.status AS revision_status,
              revision.schema_version,
              revision.codec_version,
              (device.jid IS NOT NULL AND device.jid <> '') AS jid_present,
              (device.adv_secret_available = true
                AND octet_length(device.adv_key) = 32) AS adv_secret_valid,
              (device.fingerprint_version =
                'underchat-whatsapp-device-fingerprint-v2'
                AND octet_length(device.device_fingerprint) = 32)
                AS fingerprint_valid,
              (lease.owner_id IS NULL
                AND lease.provider IS NULL
                AND lease.epoch IS NULL
                AND lease.acquired_at IS NULL
                AND lease.heartbeat_at IS NULL
                AND lease.expires_at IS NULL) AS lease_released,
              (runtime.runtime_generation = 1
                AND runtime.source_provider = 'baileys'
                AND runtime.session_storage = 'postgres'
                AND runtime.session_volume_name IS NULL
                AND runtime.runtime_capability_hash = session.capability_hash
                AND runtime.session_writer_epoch = session.epoch)
                AS runtime_valid,
              (device.jid ~ ':[1-9][0-9]*@') AS full_device_wid,
              (revision.checksum_sha256 ~ '^[a-f0-9]{64}$'
                AND revision.size_bytes > 0) AS checkpoint_valid,
              (SELECT count(*)::integer
                 FROM public.whatsapp_identity_keys state_row
                WHERE state_row.session_id = session.session_id
                  AND state_row.revision_id = session.active_revision_id)
                AS identity_key_count,
              (SELECT count(*)::integer
                 FROM public.whatsapp_pre_keys state_row
                WHERE state_row.session_id = session.session_id
                  AND state_row.revision_id = session.active_revision_id)
                AS pre_key_count,
              (SELECT count(*)::integer
                 FROM public.whatsapp_signal_sessions state_row
                WHERE state_row.session_id = session.session_id
                  AND state_row.revision_id = session.active_revision_id)
                AS signal_session_count,
              (SELECT count(*)::integer
                 FROM public.whatsapp_sender_keys state_row
                WHERE state_row.session_id = session.session_id
                  AND state_row.revision_id = session.active_revision_id)
                AS sender_key_count,
              (SELECT count(*)::integer
                 FROM public.whatsapp_app_state_sync_keys state_row
                WHERE state_row.session_id = session.session_id
                  AND state_row.revision_id = session.active_revision_id)
                AS app_state_key_count
         FROM public.whatsapp_session session
         JOIN public.worker worker
           ON worker.worker_id = session.session_id
          AND worker.name = $2
         LEFT JOIN public.whatsapp_session_revision revision
           ON revision.session_id = session.session_id
          AND revision.revision_id = session.active_revision_id
         LEFT JOIN public.whatsapp_device device
           ON device.session_id = session.session_id
          AND device.revision_id = session.active_revision_id
         JOIN public.whatsapp_session_lease lease
           ON lease.session_id = session.session_id
         JOIN public.worker_runtime runtime
           ON runtime.worker_id = session.session_id
        WHERE session.session_id = $1::uuid`,
      [settings.sessionId, fixtureMarker(settings.sessionId)]
    );
    assert.equal(result.rowCount, 1, 'baileys_canary_fixture_missing');
    const row = result.rows[0];
    if (requireReady) {
      assert.equal(row.state, 'ready');
      assert.equal(row.provider, 'baileys');
      assert.equal(row.revision_status, 'active');
      assert.equal(row.schema_version, SCHEMA_VERSION);
      assert.equal(row.codec_version, 1);
      assert.equal(row.jid_present, true);
      assert.equal(row.adv_secret_valid, true);
      assert.equal(row.fingerprint_valid, true);
      assert.equal(row.lease_released, true);
      assert.equal(row.runtime_valid, true);
      assert.equal(row.full_device_wid, true);
      assert.equal(row.checkpoint_valid, true);
      assert.ok(
        row.identity_key_count > 0,
        'baileys_canary_identity_keys_missing'
      );
      assert.ok(row.pre_key_count > 0, 'baileys_canary_pre_keys_missing');
      assert.ok(
        row.signal_session_count > 0,
        'baileys_canary_signal_sessions_missing'
      );
      assert.ok(
        row.app_state_key_count > 0,
        'baileys_canary_app_state_keys_missing'
      );
    }
    return row;
  } finally {
    await pool.end();
  }
};

const waitForReadyGate = async (
  settings,
  { requireCheckpoint = true } = {}
) => {
  const deadline = Date.now() + READY_GATE_TIMEOUT_MS;
  let last;
  do {
    last = await inspectFixture(settings);
    if (
      last.state === 'ready' &&
      last.revision_status === 'active' &&
      last.jid_present === true &&
      last.adv_secret_valid === true &&
      last.fingerprint_valid === true &&
      last.runtime_valid === true &&
      last.full_device_wid === true &&
      (!requireCheckpoint || last.checkpoint_valid === true) &&
      last.identity_key_count > 0 &&
      last.pre_key_count > 0 &&
      last.signal_session_count > 0 &&
      last.app_state_key_count > 0
    ) {
      return last;
    }
    await delay(1000);
  } while (Date.now() < deadline);
  throw new Error('baileys_canary_ready_gate_timeout');
};

const safeDisconnectStatus = (error) => {
  const candidates = [
    error?.output?.statusCode,
    error?.data?.statusCode,
    error?.statusCode,
  ];
  return candidates.find(
    (value) => Number.isInteger(value) && value >= 100 && value <= 999
  );
};

const cleanupFixture = async (settings) => {
  const artifacts = await loadArtifacts(settings);
  const baileysUrl = pathToFileURL(path.resolve(settings.baileysEntry)).href;
  const baileys = await import(baileysUrl);
  if (typeof baileys.PostgresSessionLease !== 'function') {
    throw new Error('baileys_canary_postgres_lease_api_missing');
  }
  const runtimePool = new Pool({
    connectionString: settings.runtimeDatabaseUrl,
  });
  const lease = new baileys.PostgresSessionLease({
    database: runtimePool,
    logger: silentLogger,
    sessionId: settings.sessionId,
    ownerId: settings.ownerId,
    generation: 1,
    epoch: settings.epoch,
    capability: settings.capability,
    debug: true,
  });
  try {
    let acquired = false;
    for (let attempt = 0; attempt < 10 && !acquired; attempt += 1) {
      try {
        await lease.acquire();
        acquired = true;
      } catch (error) {
        if (error?.code !== 'LEASE_NOT_ACQUIRED' || attempt === 9) throw error;
        await delay(5000);
      }
    }
    if ((await lease.release()) !== true) {
      throw new Error('baileys_canary_lease_release_failed');
    }
  } finally {
    await runtimePool.end();
  }

  const adminPool = new Pool({ connectionString: settings.adminDatabaseUrl });
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const fixture = await client.query(
      `SELECT worker.name,
              session.provider,
              (lease.owner_id IS NULL
                AND lease.provider IS NULL
                AND lease.epoch IS NULL
                AND lease.acquired_at IS NULL
                AND lease.heartbeat_at IS NULL
                AND lease.expires_at IS NULL) AS lease_released
         FROM public.worker worker
         JOIN public.whatsapp_session session
           ON session.session_id = worker.worker_id
         JOIN public.whatsapp_session_lease lease
           ON lease.session_id = worker.worker_id
        WHERE worker.worker_id = $1::uuid
        FOR UPDATE OF worker, session, lease`,
      [settings.sessionId]
    );
    assert.deepEqual(fixture.rows, [
      {
        name: fixtureMarker(settings.sessionId),
        provider: 'baileys',
        lease_released: true,
      },
    ]);
    const deleted = await client.query(
      `DELETE FROM public.worker
        WHERE worker_id = $1::uuid
          AND name = $2`,
      [settings.sessionId, fixtureMarker(settings.sessionId)]
    );
    assert.equal(deleted.rowCount, 1, 'baileys_canary_cleanup_target_missing');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await adminPool.end();
  }
  await fs.promises.rm(artifacts.qrPath, { force: true });
  await fs.promises.rm(artifacts.statePath, { force: true });
  await fs.promises.rmdir(artifacts.directory).catch(() => {});
  log('fixture_cleaned', { provider: 'baileys', lease_released: true });
};

const pair = async (settings, { resume = false } = {}) => {
  const artifacts = resume
    ? await loadArtifacts(settings)
    : await createArtifacts(settings);
  if (!resume) await bootstrapFixture(settings);
  const baileysUrl = pathToFileURL(path.resolve(settings.baileysEntry)).href;
  const baileys = await import(baileysUrl);
  assert.equal(
    typeof baileys.usePostgresAuthState,
    'function',
    'baileys_1_0_5_postgres_api_missing'
  );
  assert.equal(
    typeof baileys.default,
    'function',
    'baileys_socket_api_missing'
  );
  if (typeof baileys.fetchLatestWaWebVersion !== 'function') {
    throw new Error('baileys_canary_wa_web_version_api_missing');
  }
  const versionResult = await baileys.fetchLatestWaWebVersion();
  const waWebVersion = versionResult?.version;
  if (
    versionResult?.isLatest !== true ||
    !Array.isArray(waWebVersion) ||
    waWebVersion.length !== 3 ||
    !waWebVersion.every(Number.isInteger)
  ) {
    throw new Error('baileys_canary_wa_web_version_unavailable');
  }
  log('wa_web_version_resolved', {
    version: waWebVersion.join('.'),
  });

  const runtimePool = new Pool({
    connectionString: settings.runtimeDatabaseUrl,
  });
  let socket;
  let auth;
  let credsPersistence;
  let qrWriteTail = Promise.resolve();
  let opened = false;
  let qrGeneration = 0;
  let restartGeneration = 0;
  let preOpenReconnectGeneration = 0;
  let pairingTimer;
  try {
    auth = await baileys.usePostgresAuthState({
      database: runtimePool,
      logger: silentLogger,
      sessionId: settings.sessionId,
      ownerId: settings.ownerId,
      generation: 1,
      epoch: settings.epoch,
      capability: settings.capability,
      debug: true,
      onLost: async () => {
        credsPersistence?.stopAccepting();
        await closeBaileysSocket(
          socket,
          new Error('baileys_canary_lease_lost')
        );
      },
    });
    credsPersistence = createCredsPersistenceQueue(() => auth.saveCreds());
    const openedPromise = new Promise((resolve, reject) => {
      pairingTimer = setTimeout(
        () => reject(new Error('baileys_canary_pairing_timeout')),
        PAIRING_TIMEOUT_MS
      );
      const startSocket = () => {
        const currentSocket = baileys.default({
          auth: auth.state,
          version: waWebVersion,
          logger: silentLogger,
          printQRInTerminal: false,
          markOnlineOnConnect: false,
          syncFullHistory: true,
          generateHighQualityLinkPreview: false,
          browser: baileys.Browsers?.ubuntu?.('Underchat canary'),
        });
        socket = currentSocket;
        if (!credsPersistence.attach(currentSocket.ev)) {
          void closeBaileysSocket(
            currentSocket,
            new Error('baileys_canary_credential_persistence_stopped')
          ).catch(() => false);
          reject(new Error('baileys_canary_credential_persistence_stopped'));
          return;
        }
        currentSocket.ev.on('connection.update', (update) => {
          if (typeof update.qr === 'string' && update.qr.length > 0) {
            qrGeneration += 1;
            const currentQrGeneration = qrGeneration;
            qrWriteTail = qrWriteTail
              .then(() =>
                QRCode.toFile(artifacts.qrPath, update.qr, {
                  errorCorrectionLevel: 'M',
                  margin: 4,
                  width: 512,
                })
              )
              .then(() => fs.promises.chmod(artifacts.qrPath, 0o600))
              .then(() =>
                log('qr_ready', {
                  qr_generation: currentQrGeneration,
                  qr_path: artifacts.qrPath,
                  state_path: artifacts.statePath,
                })
              );
            void qrWriteTail.catch(() =>
              reject(new Error('baileys_canary_qr_render_failed'))
            );
          }
          if (update.connection === 'open' && !opened) {
            opened = true;
            resolve();
            return;
          }
          if (update.connection !== 'close' || opened) return;
          const statusCode = safeDisconnectStatus(update.lastDisconnect?.error);
          if (statusCode === 515 && restartGeneration < 3) {
            restartGeneration += 1;
            log('restart_required', {
              restart_generation: restartGeneration,
              qr_seen: qrGeneration > 0,
            });
            credsPersistence.enqueue();
            void credsPersistence
              .drain()
              .then(async () => {
                await closeBaileysSocket(
                  currentSocket,
                  new Error('baileys_canary_restart_required')
                );
                startSocket();
              })
              .catch(reject);
            return;
          }
          if (
            (statusCode === 408 || statusCode === 428) &&
            preOpenReconnectGeneration < 5
          ) {
            preOpenReconnectGeneration += 1;
            log('pre_open_reconnect', {
              reconnect_generation: preOpenReconnectGeneration,
              status_code: statusCode,
              qr_seen: qrGeneration > 0,
            });
            credsPersistence.enqueue();
            void credsPersistence
              .drain()
              .then(async () => {
                await closeBaileysSocket(
                  currentSocket,
                  new Error('baileys_canary_pre_open_reconnect')
                );
                startSocket();
              })
              .catch(reject);
            return;
          }
          log('connection_closed_before_open', {
            ...(statusCode ? { status_code: statusCode } : {}),
            qr_seen: qrGeneration > 0,
          });
          reject(new Error('baileys_canary_connection_closed_before_open'));
        });
      };
      startSocket();
    });

    await openedPromise;
    clearTimeout(pairingTimer);
    log('socket_open', { provider: 'baileys' });
    await qrWriteTail;
    await fs.promises.rm(artifacts.qrPath, { force: true });
    await credsPersistence.drain();
    const ready = await waitForReadyGate(settings, {
      requireCheckpoint: false,
    });
    log('canonical_ready', {
      identity_key_count: ready.identity_key_count,
      pre_key_count: ready.pre_key_count,
      signal_session_count: ready.signal_session_count,
      sender_key_count: ready.sender_key_count,
      app_state_key_count: ready.app_state_key_count,
    });
    const checkpoint = await quiesceBaileysForHandoff({
      auth,
      credsPersistence,
      socket,
      closeError: new Error('baileys_canary_handoff_checkpoint'),
    });
    assert.ok(checkpoint.records.length > 0, 'baileys_canary_checkpoint_empty');
    assert.ok(checkpoint.sizeBytes > 0, 'baileys_canary_checkpoint_size_empty');
    log('checkpoint_prepared', {
      record_count: checkpoint.records.length,
      size_bytes: checkpoint.sizeBytes,
    });
    await auth.closeForHandoff();
    auth = undefined;
    await runtimePool.end();
    const released = await inspectFixture(settings, { requireReady: true });
    assert.equal(released.lease_released, true);
    log('fixture_ready', {
      state_path: artifacts.statePath,
      provider: 'baileys',
      schema_version: SCHEMA_VERSION,
      adv_secret_available: true,
      fingerprint_valid: true,
      runtime_valid: true,
      full_device_wid: true,
      checkpoint_valid: released.checkpoint_valid,
      identity_key_count: ready.identity_key_count,
      pre_key_count: ready.pre_key_count,
      signal_session_count: ready.signal_session_count,
      sender_key_count: ready.sender_key_count,
      app_state_key_count: ready.app_state_key_count,
      lease_released: true,
    });
  } catch (error) {
    clearTimeout(pairingTimer);
    await fs.promises.rm(artifacts.qrPath, { force: true }).catch(() => {});
    credsPersistence?.stopAccepting();
    await closeBaileysSocket(
      socket,
      new Error('baileys_canary_pairing_cleanup')
    ).catch(() => false);
    await credsPersistence?.drain().catch(() => {});
    await auth?.close?.().catch(() => {});
    await runtimePool.end().catch(() => {});
    log('pairing_failed', {
      error_code:
        typeof error?.message === 'string' &&
        /^baileys_canary_[a-z0-9_]+$/u.test(error.message)
          ? error.message
          : 'baileys_canary_pairing_failed',
      state_path: artifacts.statePath,
    });
    throw error;
  }
};

const main = async () => {
  const settings = config();
  if (settings.action === 'pair') {
    await pair(settings);
    return;
  }
  if (settings.action === 'resume') {
    await pair(settings, { resume: true });
    return;
  }
  if (settings.action === 'inspect') {
    const row = await inspectFixture(settings);
    log('fixture_inspected', {
      provider: row.provider,
      state: row.state,
      revision_status: row.revision_status,
      schema_version: row.schema_version,
      jid_present: row.jid_present,
      adv_secret_valid: row.adv_secret_valid,
      fingerprint_valid: row.fingerprint_valid,
      runtime_valid: row.runtime_valid,
      full_device_wid: row.full_device_wid,
      checkpoint_valid: row.checkpoint_valid,
      lease_released: row.lease_released,
      identity_key_count: row.identity_key_count,
      pre_key_count: row.pre_key_count,
      signal_session_count: row.signal_session_count,
      sender_key_count: row.sender_key_count,
      app_state_key_count: row.app_state_key_count,
    });
    return;
  }
  if (settings.action === 'cleanup') {
    await cleanupFixture(settings);
    return;
  }
  throw new Error('expected_pair_resume_inspect_or_cleanup');
};

main().catch((error) => {
  const safeCode =
    typeof error?.message === 'string' &&
    /^[a-z0-9_]{1,100}$/u.test(error.message)
      ? error.message
      : 'baileys_canary_unexpected_failure';
  const databaseCode =
    typeof error?.code === 'string' && /^[0-9A-Z]{5}$/u.test(error.code)
      ? error.code
      : undefined;
  const databaseConstraint =
    typeof error?.constraint === 'string' &&
    /^[a-z0-9_]{1,100}$/u.test(error.constraint)
      ? error.constraint
      : undefined;
  process.stderr.write(
    `${JSON.stringify({
      prefix: '[baileys-live-postgres-pairing]',
      stage: 'fatal',
      error_code: safeCode,
      ...(databaseCode ? { database_code: databaseCode } : {}),
      ...(databaseConstraint
        ? { database_constraint: databaseConstraint }
        : {}),
    })}\n`
  );
  process.exitCode = 1;
});
