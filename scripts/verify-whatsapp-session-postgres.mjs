import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import pg from 'pg';

const { Pool } = pg;

const adminDatabaseUrl = process.env.WHATSAPP_SESSION_TEST_ADMIN_DATABASE_URL;
const runtimeDatabaseUrl =
  process.env.WHATSAPP_SESSION_TEST_RUNTIME_DATABASE_URL;

if (!adminDatabaseUrl || !runtimeDatabaseUrl) {
  throw new Error(
    'WHATSAPP_SESSION_TEST_ADMIN_DATABASE_URL and WHATSAPP_SESSION_TEST_RUNTIME_DATABASE_URL are required'
  );
}

const adminTarget = new URL(adminDatabaseUrl);
const runtimeTarget = new URL(runtimeDatabaseUrl);
const databaseName = decodeURIComponent(adminTarget.pathname.slice(1));

if (
  adminTarget.host !== runtimeTarget.host ||
  adminTarget.pathname !== runtimeTarget.pathname
) {
  throw new Error(
    'admin and runtime URLs must target the same PostgreSQL database'
  );
}

if (
  process.env.WHATSAPP_SESSION_TEST_ALLOW_DATABASE !== 'true' &&
  !/(?:^|_)(?:codex|test)(?:_|$)/iu.test(databaseName)
) {
  throw new Error(
    `refusing to mutate non-test database ${JSON.stringify(databaseName)}`
  );
}

const adminPool = new Pool({
  connectionString: adminDatabaseUrl,
  max: 4,
  statement_timeout: 10_000,
});
const runtimePool = new Pool({
  connectionString: runtimeDatabaseUrl,
  max: 8,
  statement_timeout: 10_000,
});

const ids = {
  accountStatus: randomUUID(),
  account: randomUUID(),
  workerStatus: randomUUID(),
  workerType: randomUUID(),
  sessionA: randomUUID(),
  sessionB: randomUUID(),
  epochA: randomUUID(),
  epochB: randomUUID(),
  ownerA: randomUUID(),
  ownerB: randomUUID(),
  ownerCompetitor: randomUUID(),
  ownerLongWrite: randomUUID(),
  ownerTakeover: randomUUID(),
  cloneCandidateA: randomUUID(),
  cloneCandidateB: randomUUID(),
  statusSession: randomUUID(),
  statusEpoch: randomUUID(),
  statusOwner: randomUUID(),
  statusWrongOwner: randomUUID(),
  statusConnectionEpoch: randomUUID(),
  statusSource: randomUUID(),
  statusLifecycleOperation: randomUUID(),
  generationTakeoverSession: randomUUID(),
  generationTakeoverEpochOld: randomUUID(),
  generationTakeoverEpochNew: randomUUID(),
  generationTakeoverOwnerOld: randomUUID(),
  generationTakeoverOwnerNew: randomUUID(),
  generationTakeoverCompetitor: randomUUID(),
};

const capabilityA = `codex-postgres-e2e-a-${randomUUID()}`;
const capabilityB = `codex-postgres-e2e-b-${randomUUID()}`;
const statusCapability = `codex-postgres-status-${randomUUID()}`;
const generationTakeoverCapabilityOld = `codex-postgres-generation-old-${randomUUID()}`;
const generationTakeoverCapabilityNew = `codex-postgres-generation-new-${randomUUID()}`;
const capabilityHash = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const sharedJid = '5511999999999:7@s.whatsapp.net';
const sharedChatJid = '5511888888888@s.whatsapp.net';
const sharedSignalTheirId = '5511777777777:9@s.whatsapp.net';
const fingerprintVersion = 'underchat-whatsapp-device-fingerprint-v2';
const wwebjsWorkerTypeId = '019a930d-c6f6-766d-9c84-62b9c3e7d1f0';
const lifecycleWorkerStatusId = '019a930d-c6f6-766d-9c84-46093814d8e0';
const onlineWorkerStatusId = '019a930d-c6f6-766d-9c84-30af6ecc33b2';
const offlineWorkerStatusId = '019a930d-c6f6-766d-9c84-3696c2cd5ed8';
const mismatchedWorkerStatusId = '019a930d-c6f6-766d-9c84-5056ccf66633';
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const log = (stage, fields = {}) => {
  process.stdout.write(
    `${JSON.stringify({
      prefix: '[whatsapp-session-postgres-e2e]',
      stage,
      database: databaseName,
      ...fields,
    })}\n`
  );
};

const expectPostgresError = async (operation, expectedCode) => {
  try {
    await operation();
  } catch (error) {
    assert.equal(
      error?.code,
      expectedCode,
      `expected PostgreSQL error ${expectedCode}, got ${error?.code}: ${error?.message}`
    );
    return;
  }
  assert.fail(`expected PostgreSQL error ${expectedCode}`);
};

const acquireLease = async ({
  sessionId,
  ownerId,
  epoch,
  capability,
  generation = 1,
  ttlMs = 30_000,
}) => {
  const result = await runtimePool.query(
    `SELECT fencing_token, remaining_ms
       FROM public.acquire_whatsapp_session_lease(
         $1::uuid, $2::uuid, 'wwebjs', $3::integer, $4::uuid,
         $5::integer, $6::text
       )`,
    [sessionId, ownerId, generation, epoch, ttlMs, capability]
  );
  assert.equal(result.rowCount, 1);
  return BigInt(result.rows[0].fencing_token);
};

const renewLease = async ({
  sessionId,
  ownerId,
  token,
  epoch,
  capability,
  generation = 1,
  ttlMs = 30_000,
}) =>
  runtimePool.query(
    `SELECT fencing_token, remaining_ms
       FROM public.renew_whatsapp_session_lease(
         $1::uuid, $2::uuid, 'wwebjs', $3::bigint, $4::integer, $5::uuid,
         $6::integer, $7::text
       )`,
    [sessionId, ownerId, token.toString(), generation, epoch, ttlMs, capability]
  );

const releaseLease = async ({
  sessionId,
  ownerId,
  token,
  epoch,
  capability,
  generation = 1,
}) => {
  const result = await runtimePool.query(
    `SELECT public.release_whatsapp_session_lease(
       $1::uuid, $2::uuid, 'wwebjs', $3::bigint, $4::integer,
       $5::uuid, $6::text
     ) AS released`,
    [sessionId, ownerId, token.toString(), generation, epoch, capability]
  );
  assert.equal(result.rows[0].released, true);
};

const beginOperation = async (
  client,
  { sessionId, revisionId, ownerId, token, epoch, capability, generation = 1 }
) => {
  const result = await client.query(
    `SELECT public.begin_whatsapp_session_operation(
       $1::uuid, $2::bigint, $3::uuid, $4::bigint, $5::integer,
       $6::uuid, $7::text
     ) AS allowed`,
    [
      sessionId,
      revisionId,
      ownerId,
      token.toString(),
      generation,
      epoch,
      capability,
    ]
  );
  assert.equal(result.rows[0].allowed, true);
};

const beginMutation = async (
  client,
  { sessionId, revisionId, ownerId, token, epoch, capability, generation = 1 }
) => {
  const result = await client.query(
    `SELECT public.begin_whatsapp_session_mutation(
       $1::uuid, $2::bigint, $3::uuid, $4::bigint, $5::integer,
       $6::uuid, $7::text
     ) AS allowed`,
    [
      sessionId,
      revisionId,
      ownerId,
      token.toString(),
      generation,
      epoch,
      capability,
    ]
  );
  assert.equal(result.rows[0].allowed, true);
};

const canonicalStateTables = [
  'whatsapp_device',
  'whatsapp_identity_keys',
  'whatsapp_pre_keys',
  'whatsapp_pq_pre_keys',
  'whatsapp_pq_pre_key_state',
  'whatsapp_signal_sessions',
  'whatsapp_sender_keys',
  'whatsapp_app_state_sync_keys',
  'whatsapp_app_state_version',
  'whatsapp_app_state_mutation_macs',
  'whatsapp_contacts',
  'whatsapp_chat_settings',
  'whatsapp_message_secrets',
  'whatsapp_privacy_tokens',
  'whatsapp_nct_salt',
  'whatsapp_lid_map',
  'whatsapp_event_buffer',
  'whatsapp_retry_buffer',
  'whatsapp_provider_record',
];

const portableDeviceColumns = [
  'jid',
  'lid',
  'facebook_uuid',
  'registration_id',
  'noise_key',
  'identity_key',
  'signed_pre_key',
  'signed_pre_key_id',
  'signed_pre_key_sig',
  'adv_key',
  'adv_details',
  'adv_account_sig',
  'adv_account_sig_key',
  'adv_device_sig',
  'platform',
  'business_name',
  'push_name',
  'lid_migration_ts',
  'next_pre_key_id',
  'device_fingerprint',
  'adv_secret_available',
  'fingerprint_version',
];

const snapshotCanonicalSession = async (sessionId) => {
  const snapshot = {};
  for (const table of canonicalStateTables) {
    assert.match(table, /^whatsapp_[a-z_]+$/u);
    const result = await adminPool.query(
      `SELECT count(*)::integer AS count,
              coalesce(
                md5(string_agg(payload::text, E'\n' ORDER BY payload::text)),
                md5('')
              ) AS hash
         FROM (
           SELECT to_jsonb(scoped) - 'session_id' - 'revision_id' AS payload
             FROM public.${table} AS scoped
            WHERE scoped.session_id = $1::uuid
         ) AS owned`,
      [sessionId]
    );
    snapshot[table] = result.rows[0];
  }
  return snapshot;
};

const insertCanonicalStateMatrix = async (
  client,
  { sessionId, revisionId, marker }
) => {
  const result = await client.query(
    `WITH identity_write AS (
       INSERT INTO public.whatsapp_identity_keys (
         session_id, revision_id, their_id, identity
       ) VALUES ($1::uuid, $2::bigint, $4, decode(repeat($3, 32), 'hex'))
       RETURNING 1
     ), pre_key_write AS (
       INSERT INTO public.whatsapp_pre_keys (
         session_id, revision_id, key_id, key, uploaded
       ) VALUES ($1::uuid, $2::bigint, 7, decode(repeat($3, 32), 'hex'), false)
       RETURNING 1
     ), pq_pre_key_write AS (
       INSERT INTO public.whatsapp_pq_pre_keys (
         session_id, revision_id, key_id, key_kind, public_key, private_key,
         signature, timestamp_ms, sent_to_server
       ) VALUES (
         $1::uuid, $2::bigint, 11, 'one_time',
         decode(repeat($3, 1568), 'hex'),
         decode(repeat($3, 3168), 'hex'),
         decode(repeat($3, 64), 'hex'),
         CASE WHEN $3 = 'a1' THEN 101 ELSE 202 END,
         false
       )
       RETURNING 1
     ), pq_pre_key_state_write AS (
       INSERT INTO public.whatsapp_pq_pre_key_state (
         session_id, revision_id, codec_version, algorithm,
         next_pre_key_id, migrated, last_server_count,
         last_server_count_timestamp_ms
       ) VALUES (
         $1::uuid, $2::bigint, 1, 'ML-KEM-1024', 12, true,
         CASE WHEN $3 = 'a1' THEN 101 ELSE 202 END,
         CASE WHEN $3 = 'a1' THEN 111 ELSE 212 END
       )
       RETURNING 1
     ), sender_key_write AS (
       INSERT INTO public.whatsapp_sender_keys (
         session_id, revision_id, chat_id, sender_id, sender_key
       ) VALUES (
         $1::uuid, $2::bigint, '5511555555555@g.us',
         '5511444444444:0@s.whatsapp.net', decode($3, 'hex')
       )
       RETURNING 1
     ), app_sync_write AS (
       INSERT INTO public.whatsapp_app_state_sync_keys (
         session_id, revision_id, key_id, key_data, timestamp, fingerprint
       ) VALUES (
         $1::uuid, $2::bigint, decode(repeat('01', 16), 'hex'),
         decode(repeat($3, 32), 'hex'),
         CASE WHEN $3 = 'a1' THEN 101 ELSE 202 END,
         decode(repeat($3, 16), 'hex')
       )
       RETURNING 1
     ), app_version_write AS (
       INSERT INTO public.whatsapp_app_state_version (
         session_id, revision_id, name, version, hash
       ) VALUES (
         $1::uuid, $2::bigint, 'regular', 1,
         decode(repeat($3, 128), 'hex')
       )
       RETURNING 1
     ), app_mac_write AS (
       INSERT INTO public.whatsapp_app_state_mutation_macs (
         session_id, revision_id, name, index_mac, version, value_mac
       )
       SELECT $1::uuid, $2::bigint, 'regular',
              decode(repeat('04', 32), 'hex'), 1,
              decode(repeat($3, 32), 'hex')
         FROM app_version_write
       RETURNING 1
     ), contact_write AS (
       INSERT INTO public.whatsapp_contacts (
         session_id, revision_id, their_jid, first_name, full_name, push_name
       ) VALUES (
         $1::uuid, $2::bigint, '5511333333333@s.whatsapp.net',
         'first-' || $3, 'full-' || $3, 'push-' || $3
       )
       RETURNING 1
     ), secret_write AS (
       INSERT INTO public.whatsapp_message_secrets (
         session_id, revision_id, chat_jid, sender_jid, message_id, key
       ) VALUES (
         $1::uuid, $2::bigint, '5511222222222@g.us',
         '5511111111111@s.whatsapp.net', 'same-message-id', decode($3, 'hex')
       )
       RETURNING 1
     ), privacy_write AS (
       INSERT INTO public.whatsapp_privacy_tokens (
         session_id, revision_id, their_jid, token, timestamp, sender_timestamp
       ) VALUES (
         $1::uuid, $2::bigint, '5511000000001@s.whatsapp.net',
         decode($3, 'hex'), CASE WHEN $3 = 'a1' THEN 101 ELSE 202 END,
         CASE WHEN $3 = 'a1' THEN 111 ELSE 212 END
       )
       RETURNING 1
     ), nct_write AS (
       INSERT INTO public.whatsapp_nct_salt (session_id, revision_id, salt)
       VALUES ($1::uuid, $2::bigint, decode(repeat($3, 32), 'hex'))
       RETURNING 1
     ), lid_write AS (
       INSERT INTO public.whatsapp_lid_map (session_id, revision_id, lid, pn)
       VALUES ($1::uuid, $2::bigint, '123456789012345', '5511999999999')
       RETURNING 1
     ), event_write AS (
       INSERT INTO public.whatsapp_event_buffer (
         session_id, revision_id, ciphertext_hash, plaintext,
         server_timestamp, insert_timestamp
       ) VALUES (
         $1::uuid, $2::bigint, decode(repeat('05', 32), 'hex'),
         decode($3, 'hex'), CASE WHEN $3 = 'a1' THEN 101 ELSE 202 END,
         CASE WHEN $3 = 'a1' THEN 111 ELSE 212 END
       )
       RETURNING 1
     ), retry_write AS (
       INSERT INTO public.whatsapp_retry_buffer (
         session_id, revision_id, chat_jid, message_id, format,
         plaintext, timestamp
       ) VALUES (
         $1::uuid, $2::bigint, '5511222222222@g.us', 'same-message-id',
         'raw', decode($3, 'hex'), CASE WHEN $3 = 'a1' THEN 101 ELSE 202 END
       )
       RETURNING 1
     ), provider_write AS (
       INSERT INTO public.whatsapp_provider_record (
         session_id, revision_id, namespace, record_key, codec_version, payload
       ) VALUES (
         $1::uuid, $2::bigint, 'e2e/provider', 'same-record-key', 1,
         decode($3, 'hex')
       )
       RETURNING 1
     )
     SELECT
       (SELECT count(*) FROM identity_write) +
       (SELECT count(*) FROM pre_key_write) +
       (SELECT count(*) FROM pq_pre_key_write) +
       (SELECT count(*) FROM pq_pre_key_state_write) +
       (SELECT count(*) FROM sender_key_write) +
       (SELECT count(*) FROM app_sync_write) +
       (SELECT count(*) FROM app_version_write) +
       (SELECT count(*) FROM app_mac_write) +
       (SELECT count(*) FROM contact_write) +
       (SELECT count(*) FROM secret_write) +
       (SELECT count(*) FROM privacy_write) +
       (SELECT count(*) FROM nct_write) +
       (SELECT count(*) FROM lid_write) +
       (SELECT count(*) FROM event_write) +
       (SELECT count(*) FROM retry_write) +
       (SELECT count(*) FROM provider_write) AS inserted`,
    [sessionId, revisionId.toString(), marker, sharedSignalTheirId]
  );
  assert.equal(Number(result.rows[0].inserted), 16);
};

const seedFixtures = async () => {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const version = await client.query(
      'SELECT version, compat FROM public.whatsapp_store_version'
    );
    assert.deepEqual(version.rows, [{ version: 17, compat: 17 }]);

    await client.query(
      `INSERT INTO public.account_status (account_status_id, name)
       VALUES ($1::uuid, 'e2e-active')`,
      [ids.accountStatus]
    );
    await client.query(
      `INSERT INTO public.account (account_id, account_status_id, name)
       VALUES ($1::uuid, $2::uuid, 'pg-e2e')`,
      [ids.account, ids.accountStatus]
    );
    await client.query(
      `INSERT INTO public.worker_status (worker_status_id, status)
       VALUES ($1::uuid, 'e2e-ready')`,
      [ids.workerStatus]
    );
    await client.query(
      `INSERT INTO public.worker_type (worker_type_id, type)
       VALUES ($1::uuid, 'wwebjs')`,
      [ids.workerType]
    );
    await client.query(
      `INSERT INTO public.worker (
         worker_id, worker_status_id, worker_type_id, account_id, name,
         number, session_storage
       )
       VALUES
         ($1::uuid, $3::uuid, $4::uuid, $5::uuid, 'pg-e2e-a', $6, 'postgres'),
         ($2::uuid, $3::uuid, $4::uuid, $5::uuid, 'pg-e2e-b', $6, 'postgres')`,
      [
        ids.sessionA,
        ids.sessionB,
        ids.workerStatus,
        ids.workerType,
        ids.account,
        '5511999999999',
      ]
    );

    await client.query(
      `INSERT INTO public.worker (
         worker_id, worker_status_id, worker_type_id, account_id, name,
         number, session_storage
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         'pg-e2e-native-status', '5511999999988', 'postgres'
       )`,
      [
        ids.statusSession,
        offlineWorkerStatusId,
        wwebjsWorkerTypeId,
        ids.account,
      ]
    );
    await client.query(
      `INSERT INTO public.worker_runtime (
         worker_id, container_id, session_storage, runtime_generation,
         runtime_capability_hash, session_writer_epoch, connection_epoch,
         connection_sequence, source_provider
       ) VALUES (
         $1::uuid, 'abcdef123456', 'postgres', 1, $2, $3::uuid,
         $4::uuid::text, 1, 'wwebjs'
       )`,
      [
        ids.statusSession,
        capabilityHash(statusCapability),
        ids.statusEpoch,
        ids.statusConnectionEpoch,
      ]
    );
    await client.query(
      `INSERT INTO public.whatsapp_session (
         session_id, provider, state, generation, epoch, capability_hash
       ) VALUES (
         $1::uuid, 'wwebjs', 'preparing', 1, $2::uuid, $3
       )`,
      [ids.statusSession, ids.statusEpoch, capabilityHash(statusCapability)]
    );

    await client.query(
      `INSERT INTO public.worker (
         worker_id, worker_status_id, worker_type_id, account_id, name,
         number, session_storage
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         'pg-e2e-generation-takeover', '5511999999977', 'postgres'
       )`,
      [
        ids.generationTakeoverSession,
        ids.workerStatus,
        ids.workerType,
        ids.account,
      ]
    );
    await client.query(
      `INSERT INTO public.worker_runtime (
         worker_id, container_id, session_storage, runtime_generation,
         runtime_capability_hash, session_writer_epoch, connection_epoch,
         connection_sequence, source_provider
       ) VALUES (
         $1::uuid, 'abcdef000001', 'postgres', 1, $2, $3::uuid,
         $4::uuid::text, 1, 'wwebjs'
       )`,
      [
        ids.generationTakeoverSession,
        capabilityHash(generationTakeoverCapabilityOld),
        ids.generationTakeoverEpochOld,
        randomUUID(),
      ]
    );
    await client.query(
      `INSERT INTO public.whatsapp_session (
         session_id, provider, state, generation, epoch, capability_hash
       ) VALUES (
         $1::uuid, 'wwebjs', 'preparing', 1, $2::uuid, $3
       )`,
      [
        ids.generationTakeoverSession,
        ids.generationTakeoverEpochOld,
        capabilityHash(generationTakeoverCapabilityOld),
      ]
    );
    const generationTakeoverRevision = await client.query(
      `INSERT INTO public.whatsapp_session_revision (
         session_id, provider, status, source, schema_version, codec_version,
         format, writer_generation, writer_epoch, capability_hash
       ) VALUES (
         $1::uuid, 'wwebjs', 'active', 'checkpoint', 17, 1,
         'wwebjs-profile-manifest-v1', 1, $2::uuid, $3
       ) RETURNING revision_id`,
      [
        ids.generationTakeoverSession,
        ids.generationTakeoverEpochOld,
        capabilityHash(generationTakeoverCapabilityOld),
      ]
    );
    await client.query(
      `UPDATE public.whatsapp_session
          SET state = 'ready', active_revision_id = $2::bigint
        WHERE session_id = $1::uuid`,
      [
        ids.generationTakeoverSession,
        generationTakeoverRevision.rows[0].revision_id,
      ]
    );

    for (const fixture of [
      {
        sessionId: ids.sessionA,
        epoch: ids.epochA,
        capability: capabilityA,
        fingerprint: Buffer.alloc(32, 0xa1),
        credentialByte: 0x21,
      },
      {
        sessionId: ids.sessionB,
        epoch: ids.epochB,
        capability: capabilityB,
        fingerprint: Buffer.alloc(32, 0xb2),
        credentialByte: 0x31,
      },
    ]) {
      await client.query(
        `INSERT INTO public.whatsapp_session (
           session_id, provider, state, generation, epoch, capability_hash
         )
         VALUES ($1::uuid, 'wwebjs', 'preparing', 1, $2::uuid, $3)`,
        [fixture.sessionId, fixture.epoch, capabilityHash(fixture.capability)]
      );
      const revision = await client.query(
        `INSERT INTO public.whatsapp_session_revision (
           session_id, provider, status, source, schema_version, codec_version,
           format, writer_generation, writer_epoch, capability_hash
         )
         VALUES (
           $1::uuid, 'wwebjs', 'active', 'pairing', 17, 1,
           'wwebjs-profile-manifest-v1', 1, $2::uuid, $3
         )
         RETURNING revision_id`,
        [fixture.sessionId, fixture.epoch, capabilityHash(fixture.capability)]
      );
      fixture.revisionId = BigInt(revision.rows[0].revision_id);
      await client.query(
        `INSERT INTO public.whatsapp_device (
           session_id, revision_id, jid, device_fingerprint,
           fingerprint_version, registration_id, noise_key, identity_key,
           signed_pre_key, signed_pre_key_id, signed_pre_key_sig, adv_details,
           adv_account_sig, adv_account_sig_key, adv_device_sig,
           adv_secret_available, adv_key
         )
         VALUES (
           $1::uuid, $2::bigint, $3, $4::bytea, $5, 123,
           $6::bytea, $7::bytea, $8::bytea, 7, $9::bytea, $10::bytea,
           $11::bytea, $12::bytea, $13::bytea, false, NULL
         )`,
        [
          fixture.sessionId,
          fixture.revisionId.toString(),
          sharedJid,
          fixture.fingerprint,
          fingerprintVersion,
          Buffer.alloc(32, fixture.credentialByte),
          Buffer.alloc(32, fixture.credentialByte + 1),
          Buffer.alloc(32, fixture.credentialByte + 2),
          Buffer.alloc(64, fixture.credentialByte + 3),
          Buffer.from(`adv-details-${fixture.sessionId}`, 'utf8'),
          Buffer.alloc(64, fixture.credentialByte + 4),
          Buffer.alloc(32, fixture.credentialByte + 5),
          Buffer.alloc(64, fixture.credentialByte + 6),
        ]
      );
      await client.query(
        `UPDATE public.whatsapp_session
            SET state = 'ready',
                active_revision_id = $2::bigint,
                active_device_fingerprint = $3::bytea,
                active_device_fingerprint_version = $4
          WHERE session_id = $1::uuid`,
        [
          fixture.sessionId,
          fixture.revisionId.toString(),
          fixture.fingerprint,
          fingerprintVersion,
        ]
      );
    }

    await client.query(
      `INSERT INTO public.whatsapp_session_lease (
         session_id, fencing_token, generation
       )
       SELECT session.session_id, 0, session.generation
         FROM public.whatsapp_session AS session
        WHERE session.session_id = ANY($1::uuid[])
       ON CONFLICT (session_id) DO NOTHING`,
      [
        [
          ids.sessionA,
          ids.sessionB,
          ids.statusSession,
          ids.generationTakeoverSession,
        ],
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const readRevisionIds = async () => {
  const result = await adminPool.query(
    `SELECT session_id, revision_id
       FROM public.whatsapp_session_revision
      WHERE session_id = ANY($1::uuid[])
        AND status = 'active'`,
    [[ids.sessionA, ids.sessionB]]
  );
  return new Map(
    result.rows.map((row) => [row.session_id, BigInt(row.revision_id)])
  );
};

const cleanupFixtures = async () => {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM public.worker_runtime WHERE worker_id = ANY($1::uuid[])',
      [
        [
          ids.sessionA,
          ids.sessionB,
          ids.cloneCandidateA,
          ids.cloneCandidateB,
          ids.statusSession,
          ids.generationTakeoverSession,
        ],
      ]
    );
    await client.query(
      'DELETE FROM public.worker WHERE worker_id = ANY($1::uuid[])',
      [
        [
          ids.sessionA,
          ids.sessionB,
          ids.cloneCandidateA,
          ids.cloneCandidateB,
          ids.statusSession,
          ids.generationTakeoverSession,
        ],
      ]
    );
    await client.query(
      'DELETE FROM public.worker_type WHERE worker_type_id = $1',
      [ids.workerType]
    );
    await client.query(
      'DELETE FROM public.worker_status WHERE worker_status_id = $1',
      [ids.workerStatus]
    );
    // The production account-delete transition trigger deliberately performs
    // entitlement fan-out and is outside this WhatsApp schema test. Disable
    // only that user trigger while removing this synthetic account; ALTER
    // TABLE is transactional, so a failed cleanup cannot leave it disabled.
    await client.query(
      'ALTER TABLE public.account DISABLE TRIGGER account_integration_entitlement_revision_delete'
    );
    await client.query('DELETE FROM public.account WHERE account_id = $1', [
      ids.account,
    ]);
    await client.query(
      'ALTER TABLE public.account ENABLE TRIGGER account_integration_entitlement_revision_delete'
    );
    await client.query(
      'DELETE FROM public.account_status WHERE account_status_id = $1',
      [ids.accountStatus]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const verifyActivatedGenerationTakeover = async () => {
  const revisionResult = await adminPool.query(
    `SELECT active_revision_id
       FROM public.whatsapp_session
      WHERE session_id = $1::uuid`,
    [ids.generationTakeoverSession]
  );
  const revisionId = BigInt(revisionResult.rows[0].active_revision_id);
  const oldToken = await acquireLease({
    sessionId: ids.generationTakeoverSession,
    ownerId: ids.generationTakeoverOwnerOld,
    epoch: ids.generationTakeoverEpochOld,
    capability: generationTakeoverCapabilityOld,
    generation: 1,
    ttlMs: 120_000,
  });

  const activation = await adminPool.connect();
  try {
    await activation.query('BEGIN');
    await activation.query(
      `UPDATE public.worker_runtime
          SET container_id = 'abcdef000002',
              runtime_generation = 2,
              runtime_capability_hash = $2,
              session_writer_epoch = $3::uuid,
              connection_epoch = $4::uuid::text,
              connection_sequence = connection_sequence + 1,
              updated_at = clock_timestamp()
        WHERE worker_id = $1::uuid
          AND runtime_generation = 1`,
      [
        ids.generationTakeoverSession,
        capabilityHash(generationTakeoverCapabilityNew),
        ids.generationTakeoverEpochNew,
        randomUUID(),
      ]
    );
    await activation.query(
      `UPDATE public.whatsapp_session_revision
       SET writer_generation = 2,
              writer_epoch = $3::uuid,
              capability_hash = $4
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint
          AND writer_generation = 1`,
      [
        ids.generationTakeoverSession,
        revisionId.toString(),
        ids.generationTakeoverEpochNew,
        capabilityHash(generationTakeoverCapabilityNew),
      ]
    );
    await activation.query(
      `UPDATE public.whatsapp_session
          SET generation = 2,
              epoch = $2::uuid,
              capability_hash = $3,
              updated_at = clock_timestamp()
        WHERE session_id = $1::uuid
          AND generation = 1`,
      [
        ids.generationTakeoverSession,
        ids.generationTakeoverEpochNew,
        capabilityHash(generationTakeoverCapabilityNew),
      ]
    );
    await activation.query('COMMIT');
  } catch (error) {
    await activation.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    activation.release();
  }

  const takeoverStartedAt = Date.now();
  const newToken = await acquireLease({
    sessionId: ids.generationTakeoverSession,
    ownerId: ids.generationTakeoverOwnerNew,
    epoch: ids.generationTakeoverEpochNew,
    capability: generationTakeoverCapabilityNew,
    generation: 2,
    ttlMs: 30_000,
  });
  assert(newToken > oldToken);
  assert(
    Date.now() - takeoverStartedAt < 5_000,
    'activated generation takeover waited for the retired lease TTL'
  );

  await expectPostgresError(
    () =>
      acquireLease({
        sessionId: ids.generationTakeoverSession,
        ownerId: ids.generationTakeoverCompetitor,
        epoch: ids.generationTakeoverEpochNew,
        capability: generationTakeoverCapabilityNew,
        generation: 2,
      }),
    '55000'
  );
  await expectPostgresError(
    () =>
      renewLease({
        sessionId: ids.generationTakeoverSession,
        ownerId: ids.generationTakeoverOwnerOld,
        token: oldToken,
        epoch: ids.generationTakeoverEpochOld,
        capability: generationTakeoverCapabilityOld,
        generation: 1,
      }),
    '55000'
  );
  await expectPostgresError(async () => {
    const staleWriter = await runtimePool.connect();
    try {
      await staleWriter.query('BEGIN');
      await beginMutation(staleWriter, {
        sessionId: ids.generationTakeoverSession,
        revisionId,
        ownerId: ids.generationTakeoverOwnerOld,
        token: oldToken,
        epoch: ids.generationTakeoverEpochOld,
        capability: generationTakeoverCapabilityOld,
        generation: 1,
      });
    } finally {
      await staleWriter.query('ROLLBACK').catch(() => undefined);
      staleWriter.release();
    }
  }, '55000');

  const newWriter = await runtimePool.connect();
  try {
    await newWriter.query('BEGIN');
    await beginMutation(newWriter, {
      sessionId: ids.generationTakeoverSession,
      revisionId,
      ownerId: ids.generationTakeoverOwnerNew,
      token: newToken,
      epoch: ids.generationTakeoverEpochNew,
      capability: generationTakeoverCapabilityNew,
      generation: 2,
    });
    await newWriter.query(
      `UPDATE public.whatsapp_session_revision
          SET size_bytes = size_bytes + 1
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint`,
      [ids.generationTakeoverSession, revisionId.toString()]
    );
    await newWriter.query('COMMIT');
  } finally {
    await newWriter.query('ROLLBACK').catch(() => undefined);
    newWriter.release();
  }

  await releaseLease({
    sessionId: ids.generationTakeoverSession,
    ownerId: ids.generationTakeoverOwnerNew,
    token: newToken,
    epoch: ids.generationTakeoverEpochNew,
    capability: generationTakeoverCapabilityNew,
    generation: 2,
  });
  log('activated_generation_takeover_fenced_stale_writer', {
    old_token: oldToken.toString(),
    new_token: newToken.toString(),
    elapsed_ms: Date.now() - takeoverStartedAt,
  });
};

const verifyConcurrentCompanionReservation = async () => {
  const clonedFingerprint = Buffer.alloc(32, 0xcc);
  const createCandidate = async (sessionId, suffix) => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.worker (
           worker_id, worker_status_id, worker_type_id, account_id, name,
           number, session_storage
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'postgres')`,
        [
          sessionId,
          ids.workerStatus,
          ids.workerType,
          ids.account,
          `pg-e2e-clone-${suffix}`,
          `55118888000${suffix}`,
        ]
      );
      await client.query(
        `INSERT INTO public.whatsapp_session (
           session_id, provider, state, generation, epoch, capability_hash
         ) VALUES (
           $1::uuid, 'wwebjs', 'preparing', 1, $2::uuid, $3
         )`,
        [sessionId, randomUUID(), capabilityHash(`${capabilityA}-${suffix}`)]
      );
      const revision = await client.query(
        `INSERT INTO public.whatsapp_session_revision (
           session_id, provider, status, source, schema_version, codec_version,
           format, writer_generation, writer_epoch, capability_hash
         ) VALUES (
           $1::uuid, 'wwebjs', 'staging', 'pairing', 17, 1,
           'wwebjs-profile-manifest-v1', 1, $2::uuid, $3
         ) RETURNING revision_id`,
        [sessionId, randomUUID(), capabilityHash(`${capabilityA}-${suffix}`)]
      );
      await client.query(
        `INSERT INTO public.whatsapp_device (
           session_id, revision_id, jid, device_fingerprint,
           fingerprint_version, registration_id, noise_key, identity_key,
           signed_pre_key, signed_pre_key_id, signed_pre_key_sig, adv_details,
           adv_account_sig, adv_account_sig_key, adv_device_sig,
           adv_secret_available, adv_key
         ) VALUES (
           $1::uuid, $2::bigint, $3, $4::bytea, $5, 123,
           $6::bytea, $7::bytea, $8::bytea, 7, $9::bytea, $10::bytea,
           $11::bytea, $12::bytea, $13::bytea, false, NULL
         )`,
        [
          sessionId,
          revision.rows[0].revision_id,
          `55118888000${suffix}:1@s.whatsapp.net`,
          clonedFingerprint,
          fingerprintVersion,
          Buffer.alloc(32, 0xd1),
          Buffer.alloc(32, 0xd2),
          Buffer.alloc(32, 0xd3),
          Buffer.alloc(64, 0xd4),
          Buffer.from(`clone-adv-details-${suffix}`, 'utf8'),
          Buffer.alloc(64, 0xd5),
          Buffer.alloc(32, 0xd6),
          Buffer.alloc(64, 0xd7),
        ]
      );
      await client.query('COMMIT');
      return { sessionId, accepted: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return {
        sessionId,
        accepted: false,
        errorCode: error?.code,
        errorMessage: error?.message,
      };
    } finally {
      client.release();
    }
  };

  const results = await Promise.all([
    createCandidate(ids.cloneCandidateA, '1'),
    createCandidate(ids.cloneCandidateB, '2'),
  ]);
  assert.equal(
    results.filter((result) => result.accepted).length,
    1,
    JSON.stringify(results)
  );
  assert.equal(
    results.filter((result) => !result.accepted).length,
    1,
    JSON.stringify(results)
  );
  assert.equal(results.find((result) => !result.accepted)?.errorCode, '23505');

  const reservation = await adminPool.query(
    `SELECT session_id, xmin::text AS xmin, ctid::text AS ctid,
            reserved_at::text AS reserved_at
       FROM public.whatsapp_companion_reservation
      WHERE fingerprint_version = $1 AND device_fingerprint = $2::bytea`,
    [fingerprintVersion, clonedFingerprint]
  );
  assert.equal(reservation.rowCount, 1);
  assert.equal(
    reservation.rows[0].session_id,
    results.find((result) => result.accepted)?.sessionId
  );

  // Revalidating the exact same companion for another revision/reconnect of
  // one session must not update the reservation tuple. This keeps the global
  // identity fence write-once instead of turning it into another hot lease.
  await adminPool.query(
    `UPDATE public.whatsapp_device
        SET device_fingerprint = $2::bytea,
            fingerprint_version = $3
      WHERE session_id = $1::uuid`,
    [reservation.rows[0].session_id, clonedFingerprint, fingerprintVersion]
  );
  const reservationAfterReconnect = await adminPool.query(
    `SELECT xmin::text AS xmin, ctid::text AS ctid,
            reserved_at::text AS reserved_at
       FROM public.whatsapp_companion_reservation
      WHERE fingerprint_version = $1 AND device_fingerprint = $2::bytea`,
    [fingerprintVersion, clonedFingerprint]
  );
  assert.deepEqual(reservationAfterReconnect.rows[0], {
    xmin: reservation.rows[0].xmin,
    ctid: reservation.rows[0].ctid,
    reserved_at: reservation.rows[0].reserved_at,
  });

  await adminPool.query(
    'DELETE FROM public.worker WHERE worker_id = ANY($1::uuid[])',
    [[ids.cloneCandidateA, ids.cloneCandidateB]]
  );
  const released = await adminPool.query(
    `SELECT count(*)::integer AS count
       FROM public.whatsapp_companion_reservation
      WHERE fingerprint_version = $1 AND device_fingerprint = $2::bytea`,
    [fingerprintVersion, clonedFingerprint]
  );
  assert.equal(released.rows[0].count, 0);
  log('companion_reservation_race_verified', {
    accepted_candidates: 1,
    rejected_candidates: 1,
    rejected_before_network: true,
    reservation_write_once: true,
    reservation_released_on_delete: true,
  });
};

const collectPlanNodes = (node, output = []) => {
  output.push(node);
  for (const child of node.Plans ?? []) {
    collectPlanNodes(child, output);
  }
  return output;
};

const verifyPlannerAtScale = async () => {
  const client = await adminPool.connect();
  const sessionCount = 1_000;
  // The controlled fixture p95 is 20 records for these namespaces. Exercise
  // twice that cardinality per session as required by the rollout gate.
  const recordsPerSession = 40;
  // PQ key payloads are much larger (roughly 4.8 KiB each). Four per session
  // is enough to force a multi-tenant index choice without turning this
  // structural planner gate into a memory/IO benchmark.
  const pqRecordsPerSession = 4;
  const protocolRelations = new Set(canonicalStateTables);
  const summaries = [];
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query('SET LOCAL synchronous_commit = off');
    await client.query(`
      CREATE TEMP TABLE benchmark_whatsapp_sessions (
        ordinal integer PRIMARY KEY,
        session_id uuid NOT NULL UNIQUE,
        epoch uuid NOT NULL,
        capability_hash text NOT NULL
      ) ON COMMIT DROP
    `);
    await client.query(
      `INSERT INTO benchmark_whatsapp_sessions (
         ordinal, session_id, epoch, capability_hash
       )
       SELECT ordinal,
              gen_random_uuid(),
              gen_random_uuid(),
              encode(digest('whatsapp-plan-' || ordinal::text, 'sha256'), 'hex')
       FROM generate_series(1, $1::integer) AS ordinal`,
      [sessionCount]
    );
    await client.query(
      `INSERT INTO public.worker (
         worker_id, worker_status_id, worker_type_id, account_id, name,
         number, session_storage
       )
       SELECT fixture.session_id,
              $1::uuid,
              $2::uuid,
              $3::uuid,
              'pg-plan-' || fixture.ordinal::text,
              '5599' || lpad(fixture.ordinal::text, 12, '0'),
              'postgres'
       FROM benchmark_whatsapp_sessions AS fixture`,
      [ids.workerStatus, ids.workerType, ids.account]
    );
    await client.query(`
      INSERT INTO public.whatsapp_session (
        session_id, provider, state, generation, epoch, capability_hash
      )
      SELECT session_id, 'wwebjs', 'empty', 1, epoch, capability_hash
      FROM benchmark_whatsapp_sessions
    `);
    await client.query(`
      INSERT INTO public.whatsapp_session_revision (
        session_id, provider, status, source, schema_version, codec_version,
        format, writer_generation, writer_epoch, capability_hash
      )
      SELECT session_id, 'wwebjs', 'retired', 'pairing', 17, 1,
             'wwebjs-profile-manifest-v1', 1, epoch, capability_hash
      FROM benchmark_whatsapp_sessions
    `);
    await client.query(`
      CREATE TEMP TABLE benchmark_whatsapp_revisions
      ON COMMIT DROP AS
      SELECT fixture.ordinal, fixture.session_id, revision.revision_id
      FROM benchmark_whatsapp_sessions AS fixture
      JOIN public.whatsapp_session_revision AS revision
        ON revision.session_id = fixture.session_id
    `);
    await client.query(`
      CREATE UNIQUE INDEX benchmark_whatsapp_revisions_ordinal_idx
      ON benchmark_whatsapp_revisions (ordinal)
    `);
    await client.query(`
      INSERT INTO public.whatsapp_device (session_id, revision_id, jid)
      SELECT session_id, revision_id,
             '5599' || lpad(ordinal::text, 12, '0') || ':1@s.whatsapp.net'
      FROM benchmark_whatsapp_revisions
    `);
    await client.query(
      `INSERT INTO public.whatsapp_pre_keys (
         session_id, revision_id, key_id, key, uploaded
       )
       SELECT revision.session_id, revision.revision_id, record_id,
              digest(revision.session_id::text || ':pre:' || record_id::text, 'sha256'),
              record_id % 3 = 0
       FROM benchmark_whatsapp_revisions AS revision
       CROSS JOIN generate_series(1, $1::integer) AS record_id`,
      [recordsPerSession]
    );
    await client.query(
      `INSERT INTO public.whatsapp_pq_pre_keys (
         session_id, revision_id, key_id, key_kind, public_key, private_key,
         signature, timestamp_ms, sent_to_server
       )
       SELECT revision.session_id, revision.revision_id, record_id,
              'one_time',
              decode(repeat(lpad(to_hex((record_id % 254) + 1), 2, '0'), 1568), 'hex'),
              decode(repeat(lpad(to_hex((record_id % 254) + 1), 2, '0'), 3168), 'hex'),
              decode(repeat(lpad(to_hex((record_id % 254) + 1), 2, '0'), 64), 'hex'),
              record_id::bigint, false
       FROM benchmark_whatsapp_revisions AS revision
       CROSS JOIN generate_series(1, $1::integer) AS record_id`,
      [pqRecordsPerSession]
    );
    await client.query(
      `INSERT INTO public.whatsapp_pq_pre_key_state (
         session_id, revision_id, next_pre_key_id, migrated,
         last_server_count, last_server_count_timestamp_ms
       )
       SELECT session_id, revision_id, $1::integer + 1, true, $1::integer, 1
       FROM benchmark_whatsapp_revisions`,
      [pqRecordsPerSession]
    );
    await client.query(
      `INSERT INTO public.whatsapp_signal_sessions (
         session_id, revision_id, their_id, scope, session
       )
       SELECT revision.session_id, revision.revision_id,
              'plan-' || record_id::text || ':1@s.whatsapp.net',
              'default', NULL
       FROM benchmark_whatsapp_revisions AS revision
       CROSS JOIN generate_series(1, $1::integer) AS record_id`,
      [recordsPerSession]
    );
    await client.query(
      `INSERT INTO public.whatsapp_event_buffer (
         session_id, revision_id, ciphertext_hash, plaintext,
         server_timestamp, insert_timestamp
       )
       SELECT revision.session_id, revision.revision_id,
              digest(revision.session_id::text || ':event:' || record_id::text, 'sha256'),
              NULL, extract(epoch FROM clock_timestamp())::bigint - 172800,
              extract(epoch FROM clock_timestamp())::bigint - 172800
       FROM benchmark_whatsapp_revisions AS revision
       CROSS JOIN generate_series(1, $1::integer) AS record_id`,
      [recordsPerSession]
    );
    await client.query(
      `INSERT INTO public.whatsapp_privacy_tokens (
         session_id, revision_id, their_jid, token, timestamp, sender_timestamp
       )
       SELECT revision.session_id, revision.revision_id,
              'plan-' || record_id::text || '@s.whatsapp.net',
              digest(revision.session_id::text || ':privacy:' || record_id::text, 'sha256'),
              extract(epoch FROM clock_timestamp())::bigint - 172800,
              extract(epoch FROM clock_timestamp())::bigint - 172800
       FROM benchmark_whatsapp_revisions AS revision
       CROSS JOIN generate_series(1, $1::integer) AS record_id`,
      [recordsPerSession]
    );
    await client.query(
      `INSERT INTO public.whatsapp_retry_buffer (
         session_id, revision_id, chat_jid, message_id, format,
         plaintext, timestamp
       )
       SELECT revision.session_id, revision.revision_id,
              'plan-chat@s.whatsapp.net',
              'plan-message-' || record_id::text,
              'raw', convert_to('retry-' || record_id::text, 'UTF8'),
              extract(epoch FROM clock_timestamp())::bigint - 172800
       FROM benchmark_whatsapp_revisions AS revision
       CROSS JOIN generate_series(1, $1::integer) AS record_id`,
      [recordsPerSession]
    );

    for (const relation of [
      'whatsapp_pre_keys',
      'whatsapp_pq_pre_keys',
      'whatsapp_signal_sessions',
      'whatsapp_event_buffer',
      'whatsapp_privacy_tokens',
      'whatsapp_retry_buffer',
    ]) {
      await client.query(`ANALYZE public.${relation}`);
    }

    const target = await client.query(`
      SELECT session_id, revision_id
      FROM benchmark_whatsapp_revisions
      WHERE ordinal = 501
    `);
    const targetSessionID = target.rows[0].session_id;
    const targetRevisionID = target.rows[0].revision_id;
    const explain = async (label, sql, params) => {
      const result = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${sql}`,
        params
      );
      const document = result.rows[0]['QUERY PLAN'];
      const root = Array.isArray(document)
        ? document[0]
        : JSON.parse(document)[0];
      const nodes = collectPlanNodes(root.Plan);
      const globalScans = nodes.filter(
        (node) =>
          node['Node Type'] === 'Seq Scan' &&
          protocolRelations.has(node['Relation Name'])
      );
      assert.equal(
        globalScans.length,
        0,
        `${label} performed a protocol-table Seq Scan: ${JSON.stringify(globalScans)}`
      );
      assert(
        nodes.some(
          (node) =>
            protocolRelations.has(node['Relation Name']) &&
            /Index/u.test(node['Node Type'])
        ),
        `${label} did not use an index-backed protocol access path`
      );
      summaries.push({
        label,
        execution_ms: root['Execution Time'],
        shared_hit_blocks: root.Plan['Shared Hit Blocks'] ?? 0,
        shared_read_blocks: root.Plan['Shared Read Blocks'] ?? 0,
        wal_records: root.Plan['WAL Records'] ?? 0,
        node_types: [...new Set(nodes.map((node) => node['Node Type']))],
      });
    };

    await explain(
      'signal_point_read',
      `SELECT session
         FROM public.whatsapp_signal_sessions
        WHERE session_id = $1::uuid AND revision_id = $2::bigint
          AND their_id = 'plan-20:1@s.whatsapp.net' AND scope = 'default'`,
      [targetSessionID, targetRevisionID]
    );
    await explain(
      'pending_prekeys',
      `SELECT key_id, key
         FROM public.whatsapp_pre_keys
        WHERE session_id = $1::uuid AND revision_id = $2::bigint
          AND uploaded = false
        ORDER BY key_id
        LIMIT 20`,
      [targetSessionID, targetRevisionID]
    );
    await explain(
      'pending_pq_prekeys',
      `SELECT key_id, public_key, private_key, signature
         FROM public.whatsapp_pq_pre_keys
        WHERE session_id = $1::uuid AND revision_id = $2::bigint
          AND key_kind = 'one_time' AND sent_to_server = false
        ORDER BY key_id
        LIMIT 20`,
      [targetSessionID, targetRevisionID]
    );
    await explain(
      'event_gc_batch',
      `WITH doomed AS MATERIALIZED (
         SELECT ciphertext_hash
         FROM public.whatsapp_event_buffer
         WHERE session_id = $1::uuid AND revision_id = $2::bigint
           AND insert_timestamp <
               extract(epoch FROM clock_timestamp())::bigint - 86400
         ORDER BY insert_timestamp
         LIMIT 20
       )
       DELETE FROM public.whatsapp_event_buffer AS target
       USING doomed
       WHERE target.session_id = $1::uuid
         AND target.revision_id = $2::bigint
         AND target.ciphertext_hash = doomed.ciphertext_hash`,
      [targetSessionID, targetRevisionID]
    );
    await explain(
      'retry_expiry_read',
      `SELECT chat_jid, message_id
         FROM public.whatsapp_retry_buffer
        WHERE session_id = $1::uuid AND revision_id = $2::bigint
          AND timestamp < extract(epoch FROM clock_timestamp())::bigint - 86400
        ORDER BY timestamp
        LIMIT 20`,
      [targetSessionID, targetRevisionID]
    );

    log('planner_scale_gate_verified', {
      sessions: sessionCount,
      records_per_hot_table_per_session: recordsPerSession,
      pq_records_per_session: pqRecordsPerSession,
      p95_multiplier: 2,
      plans: summaries,
      rolled_back: true,
    });
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

const verifySameProviderSecureImportLifecycle = async ({
  sourceRevisionId,
  token,
}) => {
  const candidateChecksum = createHash('sha256')
    .update(`same-provider-secure-import:${ids.sessionA}`, 'utf8')
    .digest('hex');
  const readyChecksum = createHash('sha256')
    .update(`same-provider-secure-import-ready:${ids.sessionA}`, 'utf8')
    .digest('hex');
  const workerProjection = async () => {
    const result = await adminPool.query(
      `SELECT worker_type_id::text AS worker_type_id,
              worker_status_id::text AS worker_status_id,
              lifecycle_operation_id::text AS lifecycle_operation_id,
              session_storage,
              deleted_at
         FROM public.worker
        WHERE worker_id = $1::uuid`,
      [ids.sessionA]
    );
    assert.equal(result.rowCount, 1);
    return result.rows[0];
  };

  const fixedType = await adminPool.query(
    `UPDATE public.worker
        SET worker_type_id = $2::uuid
      WHERE worker_id = $1::uuid
        AND worker_type_id = $3::uuid
        AND session_storage = 'postgres'
        AND deleted_at IS NULL
      RETURNING worker_id`,
    [ids.sessionA, wwebjsWorkerTypeId, ids.workerType]
  );
  assert.equal(fixedType.rowCount, 1);

  const workerBefore = await workerProjection();
  assert.equal(workerBefore.worker_type_id, wwebjsWorkerTypeId);
  assert.equal(workerBefore.worker_status_id, ids.workerStatus);
  assert.notEqual(workerBefore.worker_status_id, lifecycleWorkerStatusId);
  assert.equal(workerBefore.lifecycle_operation_id, null);
  assert.equal(workerBefore.session_storage, 'postgres');
  assert.equal(workerBefore.deleted_at, null);

  const renewed = await renewLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerA,
    token,
    epoch: ids.epochA,
    capability: capabilityA,
  });
  assert.equal(renewed.rowCount, 1);

  const candidate = await runtimePool.query(
    `SELECT revision_id, handoff_id, source_revision_id
       FROM public.create_whatsapp_session_candidate(
         $1::uuid, $2::bigint, $3::uuid, 'wwebjs', $4::bigint, 1,
         $5::uuid, $6::text, 'secure_import', 17, 1,
         'wwebjs-profile-manifest-v1'
       )`,
    [
      ids.sessionA,
      sourceRevisionId.toString(),
      ids.ownerA,
      token.toString(),
      ids.epochA,
      capabilityA,
    ]
  );
  assert.equal(candidate.rowCount, 1);
  const candidateRevisionId = BigInt(candidate.rows[0].revision_id);
  const handoffId = candidate.rows[0].handoff_id;
  assert.equal(BigInt(candidate.rows[0].source_revision_id), sourceRevisionId);

  const handoffIdentity = await adminPool.query(
    `SELECT source_provider, target_provider, lifecycle_operation_id
       FROM public.whatsapp_session_handoff
      WHERE session_id = $1::uuid AND handoff_id = $2::uuid`,
    [ids.sessionA, handoffId]
  );
  assert.deepEqual(handoffIdentity.rows, [
    {
      source_provider: 'wwebjs',
      target_provider: 'wwebjs',
      lifecycle_operation_id: null,
    },
  ]);

  let sourceDevice;
  let preActivationArtifactId;
  const sourceReadClient = await runtimePool.connect();
  try {
    await sourceReadClient.query('BEGIN TRANSACTION READ ONLY');
    const sourceScope = await sourceReadClient.query(
      `SELECT source_provider, source_revision_id, target_provider,
              target_revision_id, handoff_id
         FROM public.begin_whatsapp_handoff_source_read(
           $1::uuid, $2::bigint, $3::uuid, $4::bigint, 1, $5::uuid,
           $6::text, 'wwebjs'
         )`,
      [
        ids.sessionA,
        candidateRevisionId.toString(),
        ids.ownerA,
        token.toString(),
        ids.epochA,
        capabilityA,
      ]
    );
    assert.equal(sourceScope.rowCount, 1);
    assert.equal(sourceScope.rows[0].source_provider, 'wwebjs');
    assert.equal(sourceScope.rows[0].target_provider, 'wwebjs');
    assert.equal(
      BigInt(sourceScope.rows[0].source_revision_id),
      sourceRevisionId
    );
    assert.equal(
      BigInt(sourceScope.rows[0].target_revision_id),
      candidateRevisionId
    );
    assert.equal(sourceScope.rows[0].handoff_id, handoffId);

    const device = await sourceReadClient.query(
      `SELECT ${portableDeviceColumns.map((column) => `"${column}"`).join(', ')}
         FROM public.whatsapp_device
        WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
      [ids.sessionA, sourceRevisionId.toString()]
    );
    assert.equal(device.rowCount, 1);
    sourceDevice = device.rows[0];
    await sourceReadClient.query('COMMIT');
  } finally {
    await sourceReadClient.query('ROLLBACK').catch(() => undefined);
    sourceReadClient.release();
  }

  const candidateClient = await runtimePool.connect();
  try {
    await candidateClient.query('BEGIN');
    await beginMutation(candidateClient, {
      sessionId: ids.sessionA,
      revisionId: candidateRevisionId,
      ownerId: ids.ownerA,
      token,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    const deviceValues = portableDeviceColumns.map(
      (column) => sourceDevice[column]
    );
    const deviceInsert = await candidateClient.query(
      `INSERT INTO public.whatsapp_device (
         session_id, revision_id,
         ${portableDeviceColumns.map((column) => `"${column}"`).join(', ')}
       ) VALUES (
         $1::uuid, $2::bigint,
         ${portableDeviceColumns.map((_, index) => `$${index + 3}`).join(', ')}
       )`,
      [ids.sessionA, candidateRevisionId.toString(), ...deviceValues]
    );
    assert.equal(deviceInsert.rowCount, 1);

    const artifact = await candidateClient.query(
      `INSERT INTO public.whatsapp_artifact (
         session_id, revision_id, provider, kind, status, manifest,
         checksum_sha256, size_bytes, chunk_count
       ) VALUES (
         $1::uuid, $2::bigint, 'wwebjs', 'wwebjs_profile', 'ready',
         $3::jsonb, $4, 0, 0
       ) RETURNING artifact_id`,
      [
        ids.sessionA,
        candidateRevisionId.toString(),
        JSON.stringify({ codec: 'e2e-secure-import-v1' }),
        candidateChecksum,
      ]
    );
    assert.equal(artifact.rowCount, 1);
    preActivationArtifactId = artifact.rows[0].artifact_id;

    await candidateClient.query(
      `INSERT INTO public.whatsapp_provider_record (
         session_id, revision_id, namespace, record_key, codec_version, payload
       ) VALUES (
         $1::uuid, $2::bigint, '_wwebjs_lifecycle',
         'pending_canonical_activation_v1', 1, $3::bytea
       )`,
      [
        ids.sessionA,
        candidateRevisionId.toString(),
        Buffer.from(
          JSON.stringify({
            version: 1,
            app_state_hydration_required: true,
            pq_bootstrap_required: true,
            ready_checkpoint_artifact_id: null,
            ready_checkpoint_checksum_sha256: null,
          }),
          'utf8'
        ),
      ]
    );

    const validated = await candidateClient.query(
      `UPDATE public.whatsapp_session_revision
          SET status = 'validating',
              checksum_sha256 = $3,
              size_bytes = 0,
              persisted_at = clock_timestamp()
        WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
      [ids.sessionA, candidateRevisionId.toString(), candidateChecksum]
    );
    assert.equal(validated.rowCount, 1);
    const validatingHandoff = await candidateClient.query(
      `UPDATE public.whatsapp_session_handoff
          SET state = 'validating', updated_at = clock_timestamp()
        WHERE session_id = $1::uuid
          AND handoff_id = $2::uuid
          AND target_revision_id = $3::bigint
          AND lifecycle_operation_id IS NULL`,
      [ids.sessionA, handoffId, candidateRevisionId.toString()]
    );
    assert.equal(validatingHandoff.rowCount, 1);
    await candidateClient.query('COMMIT');
  } finally {
    await candidateClient.query('ROLLBACK').catch(() => undefined);
    candidateClient.release();
  }

  // Invoke the lifecycle entry points directly. Deliberately do not install
  // a worker lifecycle operation or the lifecycle-only worker status: this is
  // the exact runtime secure-import path used by native WWebJS rehydration.
  const lifecycleProjection = async () => {
    const result = await adminPool.query(
      `SELECT session.active_revision_id::text,
              session.previous_revision_id::text,
              session.provider,
              session.state,
              source_revision.status AS source_status,
              candidate_revision.status AS candidate_status,
              candidate_revision.checksum_sha256 AS candidate_checksum,
              candidate_revision.persisted_at,
              handoff.state AS handoff_state,
              handoff.lifecycle_operation_id::text,
              handoff.point_of_no_return_at,
              handoff.pre_activation_artifact_id::text,
              encode(marker.payload, 'hex') AS marker_payload
       FROM public.whatsapp_session AS session
       JOIN public.whatsapp_session_revision AS source_revision
         ON source_revision.session_id = session.session_id
        AND source_revision.revision_id = $2::bigint
       JOIN public.whatsapp_session_revision AS candidate_revision
         ON candidate_revision.session_id = session.session_id
        AND candidate_revision.revision_id = $3::bigint
       JOIN public.whatsapp_session_handoff AS handoff
         ON handoff.session_id = session.session_id
        AND handoff.handoff_id = $4::uuid
       LEFT JOIN public.whatsapp_provider_record AS marker
         ON marker.session_id = candidate_revision.session_id
        AND marker.revision_id = candidate_revision.revision_id
        AND marker.namespace = '_wwebjs_lifecycle'
        AND marker.record_key = 'pending_canonical_activation_v1'
      WHERE session.session_id = $1::uuid`,
      [
        ids.sessionA,
        sourceRevisionId.toString(),
        candidateRevisionId.toString(),
        handoffId,
      ]
    );
    assert.equal(result.rowCount, 1);
    return result.rows[0];
  };

  const genericPromotionSql = `SELECT public.promote_whatsapp_session_revision(
       $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::bigint, 1,
       $6::uuid, $7::text, $8::text
     ) AS promoted`;
  const activationParams = [
    ids.sessionA,
    sourceRevisionId.toString(),
    candidateRevisionId.toString(),
    ids.ownerA,
    token.toString(),
    ids.epochA,
    capabilityA,
    sourceDevice.jid,
  ];
  const validatingState = await lifecycleProjection();
  await expectPostgresError(
    () => runtimePool.query(genericPromotionSql, activationParams),
    '0A000'
  );
  assert.deepEqual(await lifecycleProjection(), validatingState);

  const committed = await runtimePool.query(
    `SELECT public.commit_whatsapp_session_activation(
       $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::bigint, 1,
       $6::uuid, $7::text, $8::text
     ) AS committed`,
    activationParams
  );
  assert.equal(committed.rows[0].committed, true);
  assert.deepEqual(await workerProjection(), workerBefore);

  const activatingState = await lifecycleProjection();
  assert.equal(
    activatingState.active_revision_id,
    candidateRevisionId.toString()
  );
  assert.equal(
    activatingState.previous_revision_id,
    sourceRevisionId.toString()
  );
  assert.equal(activatingState.provider, 'wwebjs');
  assert.equal(activatingState.state, 'preparing');
  assert.equal(activatingState.source_status, 'retired');
  assert.equal(activatingState.candidate_status, 'active');
  assert.equal(activatingState.handoff_state, 'activating');
  assert.equal(activatingState.lifecycle_operation_id, null);
  assert(activatingState.point_of_no_return_at);
  assert.equal(
    activatingState.pre_activation_artifact_id,
    preActivationArtifactId
  );

  const rollbackParams = [
    ids.sessionA,
    candidateRevisionId.toString(),
    sourceRevisionId.toString(),
    ids.ownerA,
    token.toString(),
    ids.epochA,
    capabilityA,
  ];
  await expectPostgresError(
    () =>
      runtimePool.query(
        `SELECT public.rollback_whatsapp_session_revision(
         $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::bigint, 1,
         $6::uuid, $7::text
       )`,
        rollbackParams
      ),
    '55000'
  );
  assert.deepEqual(await lifecycleProjection(), activatingState);

  const finalizeSql = `SELECT public.finalize_whatsapp_session_activation(
       $1::uuid, $2::bigint, $3::uuid, $4::bigint, 1,
       $5::uuid, $6::text
     ) AS finalized`;
  const finalizeParams = [
    ids.sessionA,
    candidateRevisionId.toString(),
    ids.ownerA,
    token.toString(),
    ids.epochA,
    capabilityA,
  ];
  await expectPostgresError(
    () => runtimePool.query(finalizeSql, finalizeParams),
    '55000'
  );
  assert.deepEqual(await lifecycleProjection(), activatingState);

  let readyArtifactId;
  const checkpointClient = await runtimePool.connect();
  try {
    await checkpointClient.query('BEGIN');
    await beginMutation(checkpointClient, {
      sessionId: ids.sessionA,
      revisionId: candidateRevisionId,
      ownerId: ids.ownerA,
      token,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    const retired = await checkpointClient.query(
      `UPDATE public.whatsapp_artifact
          SET status = 'retired'
        WHERE session_id = $1::uuid
          AND artifact_id = $2::uuid
          AND revision_id = $3::bigint
          AND status = 'ready'`,
      [ids.sessionA, preActivationArtifactId, candidateRevisionId.toString()]
    );
    assert.equal(retired.rowCount, 1);
    const readyArtifact = await checkpointClient.query(
      `INSERT INTO public.whatsapp_artifact (
         session_id, revision_id, provider, kind, status, manifest,
         checksum_sha256, size_bytes, chunk_count, persisted_at
       ) VALUES (
         $1::uuid, $2::bigint, 'wwebjs', 'wwebjs_profile', 'ready',
         $3::jsonb, $4, 0, 0, clock_timestamp()
       ) RETURNING artifact_id`,
      [
        ids.sessionA,
        candidateRevisionId.toString(),
        JSON.stringify({ codec: 'e2e-secure-import-v1', stable: true }),
        readyChecksum,
      ]
    );
    assert.equal(readyArtifact.rowCount, 1);
    readyArtifactId = readyArtifact.rows[0].artifact_id;

    const persistedRevision = await checkpointClient.query(
      `UPDATE public.whatsapp_session_revision
          SET checksum_sha256 = $3,
              persisted_at = clock_timestamp()
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint
          AND status = 'active'`,
      [ids.sessionA, candidateRevisionId.toString(), readyChecksum]
    );
    assert.equal(persistedRevision.rowCount, 1);
    const persistedSession = await checkpointClient.query(
      `UPDATE public.whatsapp_session
          SET last_persisted_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE session_id = $1::uuid
          AND active_revision_id = $2::bigint
          AND provider = 'wwebjs'
          AND state = 'preparing'`,
      [ids.sessionA, candidateRevisionId.toString()]
    );
    assert.equal(persistedSession.rowCount, 1);
    const completedMarker = await checkpointClient.query(
      `UPDATE public.whatsapp_provider_record
          SET payload = $3::bytea,
              updated_at = clock_timestamp()
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint
          AND namespace = '_wwebjs_lifecycle'
          AND record_key = 'pending_canonical_activation_v1'
          AND codec_version = 1`,
      [
        ids.sessionA,
        candidateRevisionId.toString(),
        Buffer.from(
          JSON.stringify({
            version: 1,
            app_state_hydration_required: false,
            pq_bootstrap_required: false,
            ready_checkpoint_artifact_id: readyArtifactId,
            ready_checkpoint_checksum_sha256: readyChecksum,
          }),
          'utf8'
        ),
      ]
    );
    assert.equal(completedMarker.rowCount, 1);
    await checkpointClient.query('COMMIT');
  } finally {
    await checkpointClient.query('ROLLBACK').catch(() => undefined);
    checkpointClient.release();
  }

  const finalized = await runtimePool.query(finalizeSql, finalizeParams);
  assert.equal(finalized.rows[0].finalized, true);
  assert.deepEqual(await workerProjection(), workerBefore);
  const completedState = await lifecycleProjection();
  assert.equal(
    completedState.active_revision_id,
    candidateRevisionId.toString()
  );
  assert.equal(
    completedState.previous_revision_id,
    sourceRevisionId.toString()
  );
  assert.equal(completedState.state, 'ready');
  assert.equal(completedState.source_status, 'retired');
  assert.equal(completedState.candidate_status, 'active');
  assert.equal(completedState.candidate_checksum, readyChecksum);
  assert.equal(completedState.handoff_state, 'completed');
  assert.equal(completedState.marker_payload, null);

  await expectPostgresError(
    () =>
      runtimePool.query(
        `SELECT public.rollback_whatsapp_session_revision(
         $1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::bigint, 1,
         $6::uuid, $7::text
       )`,
        rollbackParams
      ),
    '55000'
  );
  assert.deepEqual(await lifecycleProjection(), completedState);

  const cleanup = await adminPool.connect();
  try {
    await cleanup.query('BEGIN');
    const lifecycleOwner = await cleanup.query(
      `SELECT pg_catalog.pg_get_userbyid(class.relowner) AS role_name
         FROM pg_catalog.pg_class AS class
        WHERE class.oid = 'public.whatsapp_session_revision'::regclass`
    );
    assert.equal(lifecycleOwner.rowCount, 1);
    const lifecycleOwnerName = lifecycleOwner.rows[0].role_name;
    assert.match(lifecycleOwnerName, /^[A-Za-z_][A-Za-z0-9_$-]*$/);
    await cleanup.query(
      `SET LOCAL ROLE "${lifecycleOwnerName.replaceAll('"', '""')}"`
    );
    const restoredSession = await cleanup.query(
      `UPDATE public.whatsapp_session
          SET provider = 'wwebjs',
              state = 'ready',
              active_revision_id = $2::bigint,
              previous_revision_id = NULL,
              active_device_fingerprint = $4::bytea,
              last_error_at = NULL,
              updated_at = clock_timestamp()
        WHERE session_id = $1::uuid
          AND active_revision_id = $3::bigint`,
      [
        ids.sessionA,
        sourceRevisionId.toString(),
        candidateRevisionId.toString(),
        sourceDevice.device_fingerprint,
      ]
    );
    assert.equal(restoredSession.rowCount, 1);
    const failedCandidate = await cleanup.query(
      `UPDATE public.whatsapp_session_revision
          SET status = 'failed',
              error_code = 'postgres_e2e_cleanup',
              retired_at = clock_timestamp()
        WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
      [ids.sessionA, candidateRevisionId.toString()]
    );
    assert.equal(failedCandidate.rowCount, 1);
    const restoredSource = await cleanup.query(
      `UPDATE public.whatsapp_session_revision
          SET status = 'active', error_code = NULL, retired_at = NULL
        WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
      [ids.sessionA, sourceRevisionId.toString()]
    );
    assert.equal(restoredSource.rowCount, 1);
    await cleanup.query(
      `DELETE FROM public.whatsapp_session_gc_queue
        WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
      [ids.sessionA, sourceRevisionId.toString()]
    );
    const deletedHandoff = await cleanup.query(
      `DELETE FROM public.whatsapp_session_handoff
        WHERE session_id = $1::uuid AND handoff_id = $2::uuid`,
      [ids.sessionA, handoffId]
    );
    assert.equal(deletedHandoff.rowCount, 1);
    const deletedCandidate = await cleanup.query(
      `DELETE FROM public.whatsapp_session_revision
        WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
      [ids.sessionA, candidateRevisionId.toString()]
    );
    assert.equal(deletedCandidate.rowCount, 1);
    const restoredFixtureType = await cleanup.query(
      `UPDATE public.worker
          SET worker_type_id = $2::uuid
        WHERE worker_id = $1::uuid
          AND worker_type_id = $3::uuid
          AND session_storage = 'postgres'
          AND deleted_at IS NULL`,
      [ids.sessionA, ids.workerType, wwebjsWorkerTypeId]
    );
    assert.equal(restoredFixtureType.rowCount, 1);
    await cleanup.query('COMMIT');
  } finally {
    await cleanup.query('ROLLBACK').catch(() => undefined);
    cleanup.release();
  }

  const residue = await adminPool.query(
    `SELECT
       (SELECT count(*) FROM public.whatsapp_session_handoff
         WHERE session_id = $1::uuid AND handoff_id = $2::uuid)::integer AS handoffs,
       (SELECT count(*) FROM public.whatsapp_session_revision
         WHERE session_id = $1::uuid AND revision_id = $3::bigint)::integer AS revisions`,
    [ids.sessionA, handoffId, candidateRevisionId.toString()]
  );
  assert.deepEqual(residue.rows, [{ handoffs: 0, revisions: 0 }]);

  log('same_provider_secure_import_lifecycle_verified', {
    provider: 'wwebjs',
    lifecycle_operation_id: null,
    non_lifecycle_status_preserved: true,
    worker_fence_values_unchanged: true,
    generic_promotion_rejected: true,
    post_cas_rollback_rejected: true,
    pre_proof_finalization_rejected: true,
    exact_ready_checkpoint_verified: true,
    candidate_residue: 0,
  });
};

const verifyArtifactBlobWriteBoundary = async ({ revisionId, token }) => {
  const payload = Buffer.from('artifact-blob-rls-conflict-fixture', 'utf8');
  const checksum = createHash('sha256').update(payload).digest('hex');
  const client = await runtimePool.connect();
  try {
    await client.query('BEGIN');
    await beginMutation(client, {
      sessionId: ids.sessionA,
      revisionId,
      ownerId: ids.ownerA,
      token,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    const uploaded = await client.query(
      `SELECT public.put_whatsapp_artifact_blobs(
         $1::uuid, $2::text[], $3::bytea[], $4::integer[]
       ) AS uploaded`,
      [ids.sessionA, [checksum], [payload], [payload.length]]
    );
    assert.equal(uploaded.rows[0].uploaded, true);

    await client.query('SAVEPOINT direct_hidden_conflict');
    await expectPostgresError(
      () =>
        client.query(
          `INSERT INTO public.whatsapp_artifact_blob (
             session_id, sha256, payload, size_bytes
           ) VALUES ($1::uuid, $2, $3::bytea, $4)
           ON CONFLICT (session_id, sha256) DO NOTHING`,
          [ids.sessionA, checksum, payload, payload.length]
        ),
      '42501'
    );
    await client.query('ROLLBACK TO SAVEPOINT direct_hidden_conflict');

    const deduplicated = await client.query(
      `SELECT public.put_whatsapp_artifact_blobs(
         $1::uuid, $2::text[], $3::bytea[], $4::integer[]
       ) AS uploaded`,
      [ids.sessionA, [checksum], [payload], [payload.length]]
    );
    assert.equal(deduplicated.rows[0].uploaded, true);
    const hidden = await client.query(
      `SELECT count(*)::integer AS count
         FROM public.whatsapp_artifact_blob
        WHERE session_id = $1::uuid AND sha256 = $2`,
      [ids.sessionA, checksum]
    );
    assert.equal(hidden.rows[0].count, 0);
    const pruned = await client.query(
      `SELECT public.prune_whatsapp_orphan_artifact_blobs($1::uuid)
         AS pruned`,
      [ids.sessionA]
    );
    assert.equal(pruned.rows[0].pruned, true);
    await client.query('COMMIT');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }

  const residue = await adminPool.query(
    `SELECT count(*)::integer AS count
       FROM public.whatsapp_artifact_blob
      WHERE session_id = $1::uuid AND sha256 = $2`,
    [ids.sessionA, checksum]
  );
  assert.equal(residue.rows[0].count, 0);
  log('artifact_blob_write_boundary_verified', {
    hidden_conflict_rejected: true,
    fenced_batch_deduplicated: true,
    orphan_pruned: true,
  });
};

const verifyNativeRuntimeStatusProjection = async () => {
  const changedAt = new Date().toISOString();
  const snapshot = {
    provider: 'wwebjs',
    status: 'online',
    connected: true,
    authenticated: true,
    sessionValid: true,
    recoverable: true,
    qrAvailable: false,
    sequence: 1,
    changedAt,
  };
  const assertLeaseLostPublicStatus = (publicStatus) => {
    assert.equal(typeof publicStatus?.changedAt, 'string');
    assert.match(
      publicStatus.changedAt,
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u
    );
    assert(Number.isFinite(Date.parse(publicStatus.changedAt)));
    assert(Date.parse(publicStatus.changedAt) >= Date.parse(changedAt));
    assert.deepEqual(
      { ...publicStatus, changedAt: undefined },
      {
        provider: 'wwebjs',
        status: 'lease_lost',
        connected: false,
        authenticated: true,
        sessionValid: true,
        recoverable: true,
        qrAvailable: false,
        sequence: 1,
        changedAt: undefined,
        reason: 'session_lease_expired',
        errorCode: 'lease_lost',
      }
    );
  };
  const applyStatus = async ({
    eventType,
    eventId = randomUUID(),
    ownerId,
    token,
    nativeSnapshot = snapshot,
    strong = false,
    extraPayload = {},
  }) => {
    const payload = {
      event_type: eventType,
      status: strong ? 'connected' : 'connecting',
      provider_state: nativeSnapshot.status,
      connection_status: nativeSnapshot,
      connection_status_source_id: ids.statusSource,
      ...(ownerId ? { connection_status_lease_owner_id: ownerId } : {}),
      ...(token !== undefined
        ? { connection_status_fencing_token: token.toString() }
        : {}),
      ...(strong
        ? {
            worker_status_id: onlineWorkerStatusId,
            session_ready: true,
            can_send: true,
            can_receive_runtime: true,
            authenticated: true,
            phone: '5511999999988',
          }
        : {
            session_ready: false,
            can_send: false,
            can_receive_runtime: false,
            authenticated: true,
          }),
      ...extraPayload,
    };
    const result = await runtimePool.query(
      `SELECT outcome, event_id
         FROM public.apply_worker_runtime_status(
           $1::uuid, $2::uuid, 'wwebjs', 1, $3::uuid,
           $4, 'abcdef123456', $5::jsonb, $6::uuid
         )`,
      [
        ids.statusSession,
        ids.account,
        ids.statusEpoch,
        statusCapability,
        JSON.stringify(payload),
        eventId,
      ]
    );
    assert.equal(result.rowCount, 1);
    return result.rows[0];
  };
  const outboxCount = async () => {
    const result = await adminPool.query(
      `SELECT count(*)::integer AS count
         FROM public.worker_runtime_event_outbox
        WHERE worker_id = $1::uuid`,
      [ids.statusSession]
    );
    return result.rows[0].count;
  };

  const token1 = await acquireLease({
    sessionId: ids.statusSession,
    ownerId: ids.statusOwner,
    epoch: ids.statusEpoch,
    capability: statusCapability,
  });

  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        ownerId: ids.statusWrongOwner,
        token: token1,
        strong: true,
      })
    ).outcome,
    'invalid'
  );
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        ownerId: ids.statusOwner,
        token: token1 + 1n,
        strong: true,
      })
    ).outcome,
    'invalid'
  );
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        ownerId: ids.statusOwner,
        token: token1,
        nativeSnapshot: { ...snapshot, sequence: 0 },
        strong: true,
      })
    ).outcome,
    'invalid'
  );
  assert.equal(await outboxCount(), 0);

  const telemetry = await applyStatus({
    eventType: 'telemetry',
    ownerId: ids.statusOwner,
    token: token1,
    nativeSnapshot: {
      ...snapshot,
      cookie: 'must-not-cross-boundary',
      qrcode: 'must-not-cross-boundary',
    },
  });
  assert.equal(telemetry.outcome, 'applied');
  assert.equal(await outboxCount(), 1);
  const canonicalAllowlist = await adminPool.query(
    `SELECT NOT (
              runtime.native_connection_status ?| ARRAY['cookie', 'qrcode']
            ) AS runtime_sanitized,
            NOT (
              outbox.payload -> 'connection_status'
                ?| ARRAY['cookie', 'qrcode']
            ) AS outbox_sanitized
       FROM public.worker_runtime AS runtime
       JOIN public.worker_runtime_event_outbox AS outbox
         ON outbox.outbox_id = runtime.native_connection_status_outbox_id
      WHERE runtime.worker_id = $1::uuid`,
    [ids.statusSession]
  );
  assert.deepEqual(canonicalAllowlist.rows, [
    { runtime_sanitized: true, outbox_sanitized: true },
  ]);

  const constraintClient = await adminPool.connect();
  try {
    await constraintClient.query('BEGIN');
    const expectConstraint = async (savepoint, statement, params = []) => {
      await constraintClient.query(`SAVEPOINT ${savepoint}`);
      await expectPostgresError(
        () => constraintClient.query(statement, params),
        '23514'
      );
      await constraintClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    };
    await expectConstraint(
      'native_projection_partial',
      `UPDATE public.worker_runtime
          SET native_connection_status_sequence = NULL
        WHERE worker_id = $1::uuid`,
      [ids.statusSession]
    );
    await expectConstraint(
      'native_proof_partial',
      `UPDATE public.worker_runtime
          SET native_connection_status_lease_owner_id = $2::uuid,
              native_connection_status_fencing_token = NULL
        WHERE worker_id = $1::uuid`,
      [ids.statusSession, ids.statusOwner]
    );
    await expectConstraint(
      'native_source_retired',
      `UPDATE public.worker_runtime
          SET native_connection_status_retired_source_ids = ARRAY[
                native_connection_status_source_id
              ]
        WHERE worker_id = $1::uuid`,
      [ids.statusSession]
    );
    await expectConstraint(
      'native_retired_null',
      `UPDATE public.worker_runtime
          SET native_connection_status_retired_source_ids =
                ARRAY[NULL::uuid]
        WHERE worker_id = $1::uuid`,
      [ids.statusSession]
    );
    await expectConstraint(
      'native_ack_incomplete',
      `UPDATE public.worker_runtime
          SET native_connection_online_acknowledged = true,
              native_connection_status = native_connection_status - 'connected',
              native_connection_status_lease_owner_id = $2::uuid,
              native_connection_status_fencing_token = $3::bigint
        WHERE worker_id = $1::uuid`,
      [ids.statusSession, ids.statusOwner, token1.toString()]
    );
    await constraintClient.query('ROLLBACK');
  } finally {
    await constraintClient.query('ROLLBACK').catch(() => undefined);
    constraintClient.release();
  }

  const strong = await applyStatus({
    eventType: 'status',
    ownerId: ids.statusOwner,
    token: token1,
    strong: true,
  });
  assert.equal(strong.outcome, 'applied');
  assert.equal(await outboxCount(), 2);

  const acknowledged = await adminPool.query(
    `SELECT runtime.native_connection_online_acknowledged AS acknowledged,
            runtime.native_connection_status_lease_owner_id AS owner_id,
            runtime.native_connection_status_fencing_token::text AS token,
            worker.worker_status_id,
            outbox.payload ? 'connection_status_lease_owner_id' AS leaked_owner,
            outbox.payload ? 'connection_status_fencing_token' AS leaked_token,
            outbox.payload ->> 'connection_status_order' AS status_order,
            outbox.payload ->> 'connection_online_acknowledged' AS payload_ack
       FROM public.worker_runtime AS runtime
       JOIN public.worker AS worker ON worker.worker_id = runtime.worker_id
       JOIN public.worker_runtime_event_outbox AS outbox
         ON outbox.outbox_id = runtime.native_connection_status_outbox_id
      WHERE runtime.worker_id = $1::uuid`,
    [ids.statusSession]
  );
  assert.equal(acknowledged.rowCount, 1);
  assert.deepEqual(
    {
      ...acknowledged.rows[0],
      status_order: undefined,
    },
    {
      acknowledged: true,
      owner_id: ids.statusOwner,
      token: token1.toString(),
      worker_status_id: onlineWorkerStatusId,
      leaked_owner: false,
      leaked_token: false,
      status_order: undefined,
      payload_ack: 'true',
    }
  );
  assert.match(acknowledged.rows[0].status_order, /^[1-9][0-9]*$/u);

  const duplicate = await applyStatus({
    eventType: 'status',
    ownerId: ids.statusOwner,
    token: token1,
    strong: true,
  });
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(await outboxCount(), 2);

  const token2 = await acquireLease({
    sessionId: ids.statusSession,
    ownerId: ids.statusOwner,
    epoch: ids.statusEpoch,
    capability: statusCapability,
  });
  assert(token2 > token1);
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        ownerId: ids.statusOwner,
        token: token1,
        strong: true,
      })
    ).outcome,
    'invalid'
  );
  const rebound = await applyStatus({
    eventType: 'status',
    ownerId: ids.statusOwner,
    token: token2,
    strong: true,
  });
  assert.equal(rebound.outcome, 'applied');
  assert.equal(await outboxCount(), 3);

  await adminPool.query(
    `UPDATE public.whatsapp_session_lease
        SET expires_at = clock_timestamp() + interval '10 seconds'
      WHERE session_id = $1::uuid
        AND owner_id = $2::uuid
        AND fencing_token = $3::bigint`,
    [ids.statusSession, ids.statusOwner, token2.toString()]
  );
  const renewedBeforeReadMargin = await renewLease({
    sessionId: ids.statusSession,
    ownerId: ids.statusOwner,
    token: token2,
    epoch: ids.statusEpoch,
    capability: statusCapability,
  });
  assert.equal(renewedBeforeReadMargin.rowCount, 1);
  assert.equal(
    (
      await adminPool.query(
        `SELECT public.reconcile_expired_whatsapp_online_acks(10, 5000)
           AS reconciled`
      )
    ).rows[0].reconciled,
    0
  );
  assert.equal(
    (
      await adminPool.query(
        `SELECT native_connection_online_acknowledged AS acknowledged
           FROM public.worker_runtime
          WHERE worker_id = $1::uuid`,
        [ids.statusSession]
      )
    ).rows[0].acknowledged,
    true
  );
  await adminPool.query(
    `UPDATE public.whatsapp_session_lease
        SET expires_at = clock_timestamp() + interval '4 seconds'
      WHERE session_id = $1::uuid
        AND owner_id = $2::uuid
        AND fencing_token = $3::bigint`,
    [ids.statusSession, ids.statusOwner, token2.toString()]
  );

  const handoffOrderedLock = await adminPool.connect();
  try {
    await handoffOrderedLock.query('BEGIN');
    await handoffOrderedLock.query(
      `SELECT 1
         FROM public.worker
        WHERE worker_id = $1::uuid
        FOR UPDATE`,
      [ids.statusSession]
    );
    const skippedLockedLifecycle = await adminPool.query(
      `SELECT public.reconcile_expired_whatsapp_online_acks(10, 5000)
         AS reconciled`
    );
    assert.equal(skippedLockedLifecycle.rows[0].reconciled, 0);
    await handoffOrderedLock.query('ROLLBACK');
  } finally {
    await handoffOrderedLock.query('ROLLBACK').catch(() => undefined);
    handoffOrderedLock.release();
  }
  const concurrentReconciliations = await Promise.all([
    adminPool.query(
      `SELECT public.reconcile_expired_whatsapp_online_acks(10, 5000)
         AS reconciled`
    ),
    adminPool.query(
      `SELECT public.reconcile_expired_whatsapp_online_acks(10, 5000)
         AS reconciled`
    ),
  ]);
  assert.equal(
    concurrentReconciliations.reduce(
      (total, result) => total + result.rows[0].reconciled,
      0
    ),
    1
  );
  await expectPostgresError(
    () =>
      renewLease({
        sessionId: ids.statusSession,
        ownerId: ids.statusOwner,
        token: token2,
        epoch: ids.statusEpoch,
        capability: statusCapability,
      }),
    '55000'
  );
  assert.equal(await outboxCount(), 4);
  const reconciledProjection = await adminPool.query(
    `SELECT worker.worker_status_id,
            runtime.native_connection_online_acknowledged AS acknowledged,
            runtime.native_connection_status_lease_owner_id AS owner_id,
            runtime.native_connection_status_fencing_token AS token,
            runtime.native_connection_status AS persisted_status,
            runtime.native_connection_public_status AS runtime_public_status,
            outbox.payload -> 'connection_status' AS public_status,
            outbox.payload ->> 'connection_status_order' AS status_order,
            outbox.payload ->> 'worker_status_id' AS payload_worker_status,
            outbox.payload ->> 'code' AS code,
            outbox.payload ? 'connection_status_lease_owner_id' AS leaked_owner,
            outbox.payload ? 'connection_status_fencing_token' AS leaked_token
       FROM public.worker_runtime AS runtime
       JOIN public.worker AS worker ON worker.worker_id = runtime.worker_id
       JOIN public.worker_runtime_event_outbox AS outbox
         ON outbox.outbox_id = runtime.native_connection_status_outbox_id
      WHERE runtime.worker_id = $1::uuid`,
    [ids.statusSession]
  );
  assert.equal(reconciledProjection.rowCount, 1);
  const reconciledRow = reconciledProjection.rows[0];
  assert.deepEqual(
    {
      ...reconciledRow,
      public_status: undefined,
      status_order: undefined,
    },
    {
      worker_status_id: offlineWorkerStatusId,
      acknowledged: false,
      owner_id: null,
      token: null,
      persisted_status: snapshot,
      runtime_public_status: reconciledRow.runtime_public_status,
      public_status: undefined,
      status_order: undefined,
      payload_worker_status: offlineWorkerStatusId,
      code: '408',
      leaked_owner: false,
      leaked_token: false,
    }
  );
  assertLeaseLostPublicStatus(reconciledRow.public_status);
  assert.deepEqual(
    reconciledRow.runtime_public_status,
    reconciledRow.public_status
  );
  assert.match(reconciledRow.status_order, /^[1-9][0-9]*$/u);
  const leaseLostOrder = BigInt(reconciledRow.status_order);
  assert.equal(
    (
      await adminPool.query(
        `SELECT public.reconcile_expired_whatsapp_online_acks(10, 5000)
           AS reconciled`
      )
    ).rows[0].reconciled,
    0
  );
  const recoveryToken = await acquireLease({
    sessionId: ids.statusSession,
    ownerId: ids.statusOwner,
    epoch: ids.statusEpoch,
    capability: statusCapability,
  });
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        ownerId: ids.statusOwner,
        token: recoveryToken,
        nativeSnapshot: snapshot,
        strong: true,
      })
    ).outcome,
    'applied'
  );
  assert.equal(await outboxCount(), 5);
  const sameSequenceReack = await adminPool.query(
    `SELECT native_connection_online_acknowledged AS acknowledged,
            runtime.native_connection_status_sequence AS sequence,
            runtime.native_connection_status_lease_owner_id AS owner_id,
            runtime.native_connection_status_fencing_token::text AS token,
            runtime.native_connection_public_status AS runtime_public_status,
            outbox.payload -> 'connection_status' AS public_status,
            outbox.payload ->> 'connection_status_order' AS status_order
       FROM public.worker_runtime AS runtime
       JOIN public.worker_runtime_event_outbox AS outbox
         ON outbox.outbox_id = runtime.native_connection_status_outbox_id
      WHERE runtime.worker_id = $1::uuid`,
    [ids.statusSession]
  );
  assert.equal(sameSequenceReack.rowCount, 1);
  assert.deepEqual(
    {
      ...sameSequenceReack.rows[0],
      public_status: undefined,
      status_order: undefined,
    },
    {
      acknowledged: true,
      sequence: '1',
      owner_id: ids.statusOwner,
      token: recoveryToken.toString(),
      runtime_public_status: snapshot,
      public_status: undefined,
      status_order: undefined,
    }
  );
  assert.deepEqual(sameSequenceReack.rows[0].public_status, snapshot);
  assert(
    BigInt(sameSequenceReack.rows[0].status_order) > leaseLostOrder,
    'same-sequence ONLINE re-ack must have a later durable outbox order'
  );

  await adminPool.query(
    `UPDATE public.worker
        SET lifecycle_operation_id = $2::uuid
      WHERE worker_id = $1::uuid`,
    [ids.statusSession, ids.statusLifecycleOperation]
  );
  await releaseLease({
    sessionId: ids.statusSession,
    ownerId: ids.statusOwner,
    token: recoveryToken,
    epoch: ids.statusEpoch,
    capability: statusCapability,
  });
  assert.equal(
    (
      await adminPool.query(
        `SELECT public.reconcile_expired_whatsapp_online_acks(10, 5000)
           AS reconciled`
      )
    ).rows[0].reconciled,
    1
  );
  assert.equal(await outboxCount(), 6);
  const lifecyclePreserved = await adminPool.query(
    `SELECT worker.worker_status_id,
            runtime.native_connection_online_acknowledged AS acknowledged,
            runtime.native_connection_public_status AS runtime_public_status,
            outbox.event_type,
            outbox.payload ? 'worker_status_id' AS leaked_worker_status,
            outbox.payload -> 'connection_status' AS public_status
       FROM public.worker_runtime AS runtime
       JOIN public.worker AS worker ON worker.worker_id = runtime.worker_id
       JOIN public.worker_runtime_event_outbox AS outbox
         ON outbox.outbox_id = runtime.native_connection_status_outbox_id
      WHERE runtime.worker_id = $1::uuid`,
    [ids.statusSession]
  );
  assert.deepEqual(
    lifecyclePreserved.rows.map((row) => ({
      ...row,
      runtime_public_status: undefined,
      public_status: undefined,
    })),
    [
      {
        worker_status_id: onlineWorkerStatusId,
        acknowledged: false,
        event_type: 'telemetry',
        leaked_worker_status: false,
        runtime_public_status: undefined,
        public_status: undefined,
      },
    ]
  );
  assertLeaseLostPublicStatus(lifecyclePreserved.rows[0].public_status);
  assert.deepEqual(
    lifecyclePreserved.rows[0].runtime_public_status,
    lifecyclePreserved.rows[0].public_status
  );
  await adminPool.query(
    `UPDATE public.worker
        SET lifecycle_operation_id = NULL
      WHERE worker_id = $1::uuid`,
    [ids.statusSession]
  );
  const postLifecycleToken = await acquireLease({
    sessionId: ids.statusSession,
    ownerId: ids.statusOwner,
    epoch: ids.statusEpoch,
    capability: statusCapability,
  });
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        ownerId: ids.statusOwner,
        token: postLifecycleToken,
        nativeSnapshot: snapshot,
        strong: true,
      })
    ).outcome,
    'applied'
  );
  assert.equal(await outboxCount(), 7);

  const loggedOutSnapshot = {
    ...snapshot,
    status: 'logged_out',
    connected: false,
    authenticated: false,
    sessionValid: false,
    recoverable: false,
    sequence: 2,
    changedAt: new Date(Date.parse(changedAt) + 2_000).toISOString(),
  };
  const loggedOutBusinessPayload = {
    worker_status_id: mismatchedWorkerStatusId,
    disconnected_user: true,
    session_ready: false,
    can_send: false,
    can_receive_runtime: false,
    authenticated: false,
    status: 'disconnected',
    provider_state: 'logged_out',
    code: '401',
    requires_connection_fence: true,
  };

  const telemetryLoggedOut = await applyStatus({
    eventType: 'telemetry',
    nativeSnapshot: loggedOutSnapshot,
  });
  assert.equal(telemetryLoggedOut.outcome, 'applied');
  const telemetryFirstWorker = await adminPool.query(
    `SELECT worker_status_id, number, container_id, connection_date
       FROM public.worker
      WHERE worker_id = $1::uuid`,
    [ids.statusSession]
  );
  assert.equal(
    telemetryFirstWorker.rows[0].worker_status_id,
    offlineWorkerStatusId
  );
  assert.equal(telemetryFirstWorker.rows[0].number, '5511999999988');

  const businessAfterTelemetry = await applyStatus({
    eventType: 'status',
    nativeSnapshot: loggedOutSnapshot,
    extraPayload: loggedOutBusinessPayload,
  });
  assert.equal(businessAfterTelemetry.outcome, 'applied');
  const businessAfterTelemetryWorker = await adminPool.query(
    `SELECT worker_status_id, number, container_id, connection_date
       FROM public.worker
      WHERE worker_id = $1::uuid`,
    [ids.statusSession]
  );
  assert.deepEqual(businessAfterTelemetryWorker.rows[0], {
    worker_status_id: mismatchedWorkerStatusId,
    number: null,
    container_id: null,
    connection_date: null,
  });
  const outboxAfterTelemetryFirst = await outboxCount();
  assert.equal(outboxAfterTelemetryFirst, 9);
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        nativeSnapshot: loggedOutSnapshot,
        extraPayload: loggedOutBusinessPayload,
      })
    ).outcome,
    'duplicate'
  );
  assert.equal(await outboxCount(), outboxAfterTelemetryFirst);

  const recoveredOnlineSnapshot = {
    ...snapshot,
    sequence: 3,
    changedAt: new Date(Date.parse(changedAt) + 3_000).toISOString(),
  };
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        ownerId: ids.statusOwner,
        token: postLifecycleToken,
        nativeSnapshot: recoveredOnlineSnapshot,
        strong: true,
      })
    ).outcome,
    'applied'
  );

  const businessFirstSnapshot = {
    ...loggedOutSnapshot,
    sequence: 4,
    changedAt: new Date(Date.parse(changedAt) + 4_000).toISOString(),
  };
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        nativeSnapshot: businessFirstSnapshot,
        extraPayload: loggedOutBusinessPayload,
      })
    ).outcome,
    'applied'
  );
  const businessFirstOutboxCount = await outboxCount();
  assert.equal(businessFirstOutboxCount, 11);
  assert.equal(
    (
      await applyStatus({
        eventType: 'telemetry',
        nativeSnapshot: businessFirstSnapshot,
      })
    ).outcome,
    'duplicate'
  );
  assert.equal(
    (
      await applyStatus({
        eventType: 'status',
        nativeSnapshot: businessFirstSnapshot,
        extraPayload: loggedOutBusinessPayload,
      })
    ).outcome,
    'duplicate'
  );
  assert.equal(await outboxCount(), businessFirstOutboxCount);
  const businessFirstWorker = await adminPool.query(
    `SELECT worker_status_id, number, container_id, connection_date
       FROM public.worker
      WHERE worker_id = $1::uuid`,
    [ids.statusSession]
  );
  assert.deepEqual(businessFirstWorker.rows[0], {
    worker_status_id: mismatchedWorkerStatusId,
    number: null,
    container_id: null,
    connection_date: null,
  });
  await releaseLease({
    sessionId: ids.statusSession,
    ownerId: ids.statusOwner,
    token: postLifecycleToken,
    epoch: ids.statusEpoch,
    capability: statusCapability,
  });

  const allPublicStatusPayloadsSanitized = await adminPool.query(
    `SELECT NOT EXISTS (
              SELECT 1
                FROM public.worker_runtime_event_outbox
               WHERE worker_id = $1::uuid
                 AND (
                   payload ? 'connection_status_lease_owner_id'
                   OR payload ? 'connection_status_fencing_token'
                 )
            ) AS sanitized`,
    [ids.statusSession]
  );
  assert.equal(allPublicStatusPayloadsSanitized.rows[0].sanitized, true);

  log('native_runtime_status_projection_verified', {
    exact_owner_token: true,
    stale_token_rejected: true,
    five_second_margin: true,
    positive_sequence_required: true,
    duplicate_outbox_elided: true,
    telemetry_online_upgraded: true,
    telemetry_business_order_converged: true,
    silent_lease_expiry_reconciled: true,
    same_sequence_online_reacknowledged: true,
    lifecycle_online_invalidated_as_telemetry: true,
    technical_payload_sanitized: true,
    nullable_checks_fail_closed: true,
  });
};

let fixturesSeeded = false;

try {
  const roleCheck = await runtimePool.query(
    `SELECT current_user,
            current_setting('is_superuser') AS is_superuser,
            rolbypassrls
       FROM pg_catalog.pg_roles
      WHERE rolname = current_user`
  );
  assert.equal(roleCheck.rows[0].is_superuser, 'off');
  assert.equal(roleCheck.rows[0].rolbypassrls, false);

  const controlPlaneFunctionPrivilege = await adminPool.query(
    `SELECT has_function_privilege(
              current_user,
              'public.reconcile_expired_whatsapp_online_acks(integer,integer)',
              'EXECUTE'
            ) AS can_reconcile`
  );
  assert.equal(controlPlaneFunctionPrivilege.rows[0].can_reconcile, true);
  const runtimePrivileges = await runtimePool.query(
    `SELECT has_function_privilege(
              current_user,
              'public.reconcile_expired_whatsapp_online_acks(integer,integer)',
              'EXECUTE'
            ) AS can_reconcile,
            has_table_privilege(
              current_user,
              'public.worker_runtime',
              'UPDATE'
            ) AS can_update_runtime`
  );
  assert.deepEqual(runtimePrivileges.rows, [
    { can_reconcile: false, can_update_runtime: false },
  ]);
  await expectPostgresError(
    () =>
      runtimePool.query(
        'SELECT public.reconcile_expired_whatsapp_online_acks(1, 5000)'
      ),
    '42501'
  );
  await expectPostgresError(
    () =>
      runtimePool.query(
        `UPDATE public.worker_runtime
            SET updated_at = updated_at
          WHERE false`
      ),
    '42501'
  );
  log('native_status_reconciler_privileges_verified', {
    control_plane_execute: true,
    runtime_execute: false,
    runtime_direct_dml: false,
  });

  await seedFixtures();
  fixturesSeeded = true;
  await verifyActivatedGenerationTakeover();
  await verifyNativeRuntimeStatusProjection();
  await verifyConcurrentCompanionReservation();
  await verifyPlannerAtScale();
  const revisions = await readRevisionIds();
  const revisionA = revisions.get(ids.sessionA);
  const revisionB = revisions.get(ids.sessionB);
  assert(revisionA);
  assert(revisionB);
  log('fixtures_seeded', { same_jid_sessions: 2 });

  const tokenA = await acquireLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerA,
    epoch: ids.epochA,
    capability: capabilityA,
  });
  await expectPostgresError(
    () =>
      acquireLease({
        sessionId: ids.sessionA,
        ownerId: ids.ownerCompetitor,
        epoch: ids.epochA,
        capability: capabilityA,
      }),
    '55000'
  );
  log('single_writer_enforced', { fencing_token: tokenA.toString() });

  const clientA = await runtimePool.connect();
  try {
    const unscoped = await clientA.query(
      'SELECT count(*)::integer AS count FROM public.whatsapp_chat_settings'
    );
    assert.equal(unscoped.rows[0].count, 0);

    await clientA.query('BEGIN');
    await beginOperation(clientA, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      ownerId: ids.ownerA,
      token: tokenA,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    const scopedRead = await clientA.query(
      `SELECT count(*)::integer AS count
         FROM public.whatsapp_device
        WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
      [ids.sessionA, revisionA.toString()]
    );
    assert.equal(scopedRead.rows[0].count, 1);
    await clientA.query('COMMIT');

    await clientA.query('BEGIN');
    await beginMutation(clientA, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      ownerId: ids.ownerA,
      token: tokenA,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    await clientA.query(
      `UPDATE public.whatsapp_device
          SET registration_id = 123,
              noise_key = $3::bytea,
              identity_key = $4::bytea,
              signed_pre_key = $5::bytea,
              signed_pre_key_id = 7,
              signed_pre_key_sig = $6::bytea,
              adv_details = $7::bytea,
              adv_account_sig = $8::bytea,
              adv_account_sig_key = $9::bytea,
              adv_device_sig = $10::bytea,
              adv_secret_available = false,
              adv_key = NULL
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint`,
      [
        ids.sessionA,
        revisionA.toString(),
        Buffer.alloc(32, 0x11),
        Buffer.alloc(32, 0x12),
        Buffer.alloc(32, 0x13),
        Buffer.alloc(64, 0x14),
        Buffer.from('adv-details-without-secret', 'utf8'),
        Buffer.alloc(64, 0x15),
        Buffer.alloc(32, 0x16),
        Buffer.alloc(64, 0x17),
      ]
    );
    const nullableAdv = await clientA.query(
      `SELECT adv_secret_available, adv_key IS NULL AS adv_key_is_null
         FROM public.whatsapp_device
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint`,
      [ids.sessionA, revisionA.toString()]
    );
    assert.deepEqual(nullableAdv.rows, [
      { adv_secret_available: false, adv_key_is_null: true },
    ]);

    await clientA.query('SAVEPOINT orphan_adv_flag');
    await expectPostgresError(
      () =>
        clientA.query(
          `UPDATE public.whatsapp_device
              SET adv_secret_available = true
            WHERE session_id = $1::uuid
              AND revision_id = $2::bigint`,
          [ids.sessionA, revisionA.toString()]
        ),
      '23514'
    );
    await clientA.query('ROLLBACK TO SAVEPOINT orphan_adv_flag');

    await clientA.query('SAVEPOINT orphan_adv_key');
    await expectPostgresError(
      () =>
        clientA.query(
          `UPDATE public.whatsapp_device
              SET adv_key = $3::bytea
            WHERE session_id = $1::uuid
              AND revision_id = $2::bigint`,
          [ids.sessionA, revisionA.toString(), Buffer.alloc(32, 0x18)]
        ),
      '23514'
    );
    await clientA.query('ROLLBACK TO SAVEPOINT orphan_adv_key');

    await clientA.query('SAVEPOINT orphan_fingerprint_version');
    await expectPostgresError(
      () =>
        clientA.query(
          `UPDATE public.whatsapp_device
              SET fingerprint_version = NULL
            WHERE session_id = $1::uuid
              AND revision_id = $2::bigint`,
          [ids.sessionA, revisionA.toString()]
        ),
      '23514'
    );
    await clientA.query('ROLLBACK TO SAVEPOINT orphan_fingerprint_version');

    await clientA.query('SAVEPOINT orphan_fingerprint_value');
    await expectPostgresError(
      () =>
        clientA.query(
          `UPDATE public.whatsapp_device
              SET device_fingerprint = NULL
            WHERE session_id = $1::uuid
              AND revision_id = $2::bigint`,
          [ids.sessionA, revisionA.toString()]
        ),
      '23514'
    );
    await clientA.query('ROLLBACK TO SAVEPOINT orphan_fingerprint_value');

    for (const [savepoint, sql, params] of [
      [
        'empty_signal_payload',
        `INSERT INTO public.whatsapp_signal_sessions (
           session_id, revision_id, their_id, scope, session
         ) VALUES ($1::uuid, $2::bigint, $3, 'default', $4::bytea)`,
        [
          ids.sessionA,
          revisionA.toString(),
          '5511666666661:0@s.whatsapp.net',
          Buffer.alloc(0),
        ],
      ],
      [
        'oversized_signal_payload',
        `INSERT INTO public.whatsapp_signal_sessions (
           session_id, revision_id, their_id, scope, session
         ) VALUES ($1::uuid, $2::bigint, $3, 'default', $4::bytea)`,
        [
          ids.sessionA,
          revisionA.toString(),
          '5511666666662:0@s.whatsapp.net',
          Buffer.alloc(8 * 1024 * 1024 + 1),
        ],
      ],
      [
        'empty_sender_payload',
        `INSERT INTO public.whatsapp_sender_keys (
           session_id, revision_id, chat_id, sender_id, sender_key
         ) VALUES ($1::uuid, $2::bigint, $3, $4, $5::bytea)`,
        [
          ids.sessionA,
          revisionA.toString(),
          '5511555555555@g.us',
          '5511444444444:0@s.whatsapp.net',
          Buffer.alloc(0),
        ],
      ],
      [
        'oversized_sender_payload',
        `INSERT INTO public.whatsapp_sender_keys (
           session_id, revision_id, chat_id, sender_id, sender_key
         ) VALUES ($1::uuid, $2::bigint, $3, $4, $5::bytea)`,
        [
          ids.sessionA,
          revisionA.toString(),
          '5511555555556@g.us',
          '5511444444445:0@s.whatsapp.net',
          Buffer.alloc(2 * 1024 * 1024 + 1),
        ],
      ],
    ]) {
      await clientA.query(`SAVEPOINT ${savepoint}`);
      await expectPostgresError(() => clientA.query(sql, params), '23514');
      await clientA.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    }

    await clientA.query(
      `INSERT INTO public.whatsapp_chat_settings (
         session_id, revision_id, chat_jid, muted_until, pinned, archived
       ) VALUES ($1::uuid, $2::bigint, $3, 111, true, false)`,
      [ids.sessionA, revisionA.toString(), sharedChatJid]
    );
    await clientA.query(
      `INSERT INTO public.whatsapp_signal_sessions (
         session_id, revision_id, their_id, scope, session
       )
       VALUES
         ($1::uuid, $2::bigint, $3, 'default', $4::bytea),
         ($1::uuid, $2::bigint, $3, 'status', $5::bytea),
         ($1::uuid, $2::bigint, $3, 'pq', $6::bytea)`,
      [
        ids.sessionA,
        revisionA.toString(),
        sharedSignalTheirId,
        Buffer.from('a-default', 'utf8'),
        Buffer.from('a-status', 'utf8'),
        Buffer.from('a-pq', 'utf8'),
      ]
    );
    await insertCanonicalStateMatrix(clientA, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      marker: 'a1',
    });
    const oneMiBOverflow = Buffer.alloc(1024 * 1024 + 1, 0xaa);
    const eightMiBOverflow = Buffer.alloc(8 * 1024 * 1024 + 1, 0xbb);
    for (const [savepoint, statement, params] of [
      [
        'oversized_adv_details',
        `UPDATE public.whatsapp_device SET adv_details = $3::bytea
          WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
        [ids.sessionA, revisionA.toString(), oneMiBOverflow],
      ],
      [
        'oversized_app_state_key',
        `UPDATE public.whatsapp_app_state_sync_keys SET key_data = $3::bytea
          WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
        [ids.sessionA, revisionA.toString(), oneMiBOverflow],
      ],
      [
        'oversized_message_secret',
        `UPDATE public.whatsapp_message_secrets SET key = $3::bytea
          WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
        [ids.sessionA, revisionA.toString(), oneMiBOverflow],
      ],
      [
        'oversized_privacy_token',
        `UPDATE public.whatsapp_privacy_tokens SET token = $3::bytea
          WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
        [ids.sessionA, revisionA.toString(), oneMiBOverflow],
      ],
      [
        'oversized_nct_salt',
        `UPDATE public.whatsapp_nct_salt SET salt = $3::bytea
          WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
        [ids.sessionA, revisionA.toString(), oneMiBOverflow],
      ],
      [
        'oversized_event_plaintext',
        `UPDATE public.whatsapp_event_buffer SET plaintext = $3::bytea
          WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
        [ids.sessionA, revisionA.toString(), eightMiBOverflow],
      ],
      [
        'oversized_retry_plaintext',
        `UPDATE public.whatsapp_retry_buffer SET plaintext = $3::bytea
          WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
        [ids.sessionA, revisionA.toString(), eightMiBOverflow],
      ],
      [
        'oversized_provider_record',
        `UPDATE public.whatsapp_provider_record SET payload = $3::bytea
          WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
        [ids.sessionA, revisionA.toString(), eightMiBOverflow],
      ],
      [
        'oversized_artifact_manifest',
        `INSERT INTO public.whatsapp_artifact (
           session_id, revision_id, provider, kind, status, manifest,
           checksum_sha256, size_bytes, chunk_count
         ) VALUES (
           $1::uuid, $2::bigint, 'wwebjs', 'e2e-manifest', 'staging',
           $3::jsonb, $4, 0, 0
         )`,
        [
          ids.sessionA,
          revisionA.toString(),
          JSON.stringify({ value: 'x'.repeat(1024 * 1024 + 1) }),
          'a'.repeat(64),
        ],
      ],
    ]) {
      await clientA.query(`SAVEPOINT ${savepoint}`);
      await expectPostgresError(
        () => clientA.query(statement, params),
        '23514'
      );
      await clientA.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    }
    const siblingRows = await clientA.query(
      `SELECT count(*)::integer AS count
         FROM public.whatsapp_device
        WHERE session_id = $1::uuid`,
      [ids.sessionB]
    );
    assert.equal(siblingRows.rows[0].count, 0);

    await clientA.query('SAVEPOINT sibling_write');
    await expectPostgresError(
      () =>
        clientA.query(
          `INSERT INTO public.whatsapp_chat_settings (
             session_id, revision_id, chat_jid
           ) VALUES ($1::uuid, $2::bigint, $3)`,
          [ids.sessionB, revisionB.toString(), sharedChatJid]
        ),
      '42501'
    );
    await clientA.query('ROLLBACK TO SAVEPOINT sibling_write');
    await clientA.query('COMMIT');

    log('canonical_device_constraints_verified', {
      nullable_adv_secret: true,
      orphan_adv_rejected: true,
      orphan_fingerprint_rejected: true,
      protocol_payload_caps_rejected: true,
      defensive_storage_caps_rejected: true,
    });

    const scopeWasLocal = await clientA.query(
      'SELECT count(*)::integer AS count FROM public.whatsapp_chat_settings'
    );
    assert.equal(scopeWasLocal.rows[0].count, 0);
  } finally {
    await clientA.query('ROLLBACK').catch(() => undefined);
    clientA.release();
  }

  await verifyArtifactBlobWriteBoundary({
    revisionId: revisionA,
    token: tokenA,
  });

  await verifySameProviderSecureImportLifecycle({
    sourceRevisionId: revisionA,
    token: tokenA,
  });

  const tokenB = await acquireLease({
    sessionId: ids.sessionB,
    ownerId: ids.ownerB,
    epoch: ids.epochB,
    capability: capabilityB,
  });
  const clientB = await runtimePool.connect();
  try {
    await clientB.query('BEGIN');
    await beginMutation(clientB, {
      sessionId: ids.sessionB,
      revisionId: revisionB,
      ownerId: ids.ownerB,
      token: tokenB,
      epoch: ids.epochB,
      capability: capabilityB,
    });
    await clientB.query(
      `INSERT INTO public.whatsapp_chat_settings (
         session_id, revision_id, chat_jid, muted_until, pinned, archived
       ) VALUES ($1::uuid, $2::bigint, $3, 222, false, true)`,
      [ids.sessionB, revisionB.toString(), sharedChatJid]
    );
    await clientB.query(
      `INSERT INTO public.whatsapp_signal_sessions (
         session_id, revision_id, their_id, scope, session
       )
       VALUES
         ($1::uuid, $2::bigint, $3, 'default', $4::bytea),
         ($1::uuid, $2::bigint, $3, 'status', $5::bytea),
         ($1::uuid, $2::bigint, $3, 'pq', $6::bytea)`,
      [
        ids.sessionB,
        revisionB.toString(),
        sharedSignalTheirId,
        Buffer.from('b-default', 'utf8'),
        Buffer.from('b-status', 'utf8'),
        Buffer.from('b-pq', 'utf8'),
      ]
    );
    await insertCanonicalStateMatrix(clientB, {
      sessionId: ids.sessionB,
      revisionId: revisionB,
      marker: 'b2',
    });
    await clientB.query('COMMIT');
  } finally {
    await clientB.query('ROLLBACK').catch(() => undefined);
    clientB.release();
  }

  const isolatedRows = await adminPool.query(
    `SELECT session_id, muted_until, pinned, archived
       FROM public.whatsapp_chat_settings
      WHERE session_id = ANY($1::uuid[])
      ORDER BY session_id`,
    [[ids.sessionA, ids.sessionB]]
  );
  assert.equal(isolatedRows.rowCount, 2);
  assert.deepEqual(
    new Set(isolatedRows.rows.map((row) => Number(row.muted_until))),
    new Set([111, 222])
  );
  log('rls_and_same_jid_isolation_verified', { rows: isolatedRows.rowCount });

  const isolatedSignalRows = await adminPool.query(
    `SELECT session_id, scope, convert_from(session, 'UTF8') AS payload
       FROM public.whatsapp_signal_sessions
      WHERE session_id = ANY($1::uuid[])
        AND their_id = $2
      ORDER BY session_id, scope`,
    [[ids.sessionA, ids.sessionB], sharedSignalTheirId]
  );
  assert.equal(isolatedSignalRows.rowCount, 6);
  for (const sessionId of [ids.sessionA, ids.sessionB]) {
    const sessionRows = isolatedSignalRows.rows.filter(
      (row) => row.session_id === sessionId
    );
    assert.deepEqual(
      new Set(sessionRows.map((row) => row.scope)),
      new Set(['default', 'status', 'pq'])
    );
    assert.equal(new Set(sessionRows.map((row) => row.payload)).size, 3);
  }
  assert.equal(
    new Set(isolatedSignalRows.rows.map((row) => row.payload)).size,
    6
  );
  log('signal_scope_and_session_isolation_verified', {
    rows: isolatedSignalRows.rowCount,
    scopes: ['default', 'status', 'pq'],
  });

  const canonicalSnapshotA = await snapshotCanonicalSession(ids.sessionA);
  const canonicalSnapshotB = await snapshotCanonicalSession(ids.sessionB);
  for (const table of canonicalStateTables) {
    const expectedCount = table === 'whatsapp_signal_sessions' ? 3 : 1;
    assert.equal(canonicalSnapshotA[table].count, expectedCount, `${table} A`);
    assert.equal(canonicalSnapshotB[table].count, expectedCount, `${table} B`);
    if (table === 'whatsapp_lid_map') {
      assert.equal(
        canonicalSnapshotA[table].hash,
        canonicalSnapshotB[table].hash
      );
    } else {
      assert.notEqual(
        canonicalSnapshotA[table].hash,
        canonicalSnapshotB[table].hash,
        `${table} must retain session-owned values`
      );
    }
  }
  log('canonical_matrix_isolation_verified', {
    tables: canonicalStateTables.length,
    same_external_ids: true,
    distinct_session_values: true,
  });

  // Reproduce the former cross-process deadlock shape: two writers for the
  // same projection try to mutate different child tables and then touch the
  // revision header. The mutation entry point must serialize them before any
  // child DML can acquire an FK row lock, so the second writer waits and both
  // transactions eventually commit without a 40P01 retry.
  const concurrentWriterA = await runtimePool.connect();
  const concurrentWriterB = await runtimePool.connect();
  try {
    await concurrentWriterA.query('BEGIN');
    await concurrentWriterB.query('BEGIN');
    await beginMutation(concurrentWriterA, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      ownerId: ids.ownerA,
      token: tokenA,
      epoch: ids.epochA,
      capability: capabilityA,
    });

    const secondWriterStartedAt = Date.now();
    const secondWriterEntry = beginMutation(concurrentWriterB, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      ownerId: ids.ownerA,
      token: tokenA,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    const secondWriterState = await Promise.race([
      secondWriterEntry.then(() => 'entered'),
      delay(150).then(() => 'blocked'),
    ]);
    assert.equal(secondWriterState, 'blocked');

    await concurrentWriterA.query(
      `UPDATE public.whatsapp_chat_settings
          SET muted_until = muted_until + 1
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint
          AND chat_jid = $3`,
      [ids.sessionA, revisionA.toString(), sharedChatJid]
    );
    await concurrentWriterA.query(
      `UPDATE public.whatsapp_session_revision
          SET size_bytes = size_bytes + 1
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint`,
      [ids.sessionA, revisionA.toString()]
    );
    await concurrentWriterA.query('COMMIT');

    await secondWriterEntry;
    await concurrentWriterB.query(
      `UPDATE public.whatsapp_contacts
          SET full_name = full_name || '-serialized'
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint
          AND their_jid = $3`,
      [ids.sessionA, revisionA.toString(), sharedJid]
    );
    await concurrentWriterB.query(
      `UPDATE public.whatsapp_session_revision
          SET size_bytes = size_bytes + 1
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint`,
      [ids.sessionA, revisionA.toString()]
    );
    await concurrentWriterB.query('COMMIT');
    log('same_session_writers_serialized', {
      second_writer_waited_ms_at_least: 150,
      elapsed_ms: Date.now() - secondWriterStartedAt,
      deadlock_retries: 0,
    });
  } finally {
    await concurrentWriterA.query('ROLLBACK').catch(() => undefined);
    await concurrentWriterB.query('ROLLBACK').catch(() => undefined);
    concurrentWriterA.release();
    concurrentWriterB.release();
  }

  await releaseLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerA,
    token: tokenA,
    epoch: ids.epochA,
    capability: capabilityA,
  });
  await releaseLease({
    sessionId: ids.sessionB,
    ownerId: ids.ownerB,
    token: tokenB,
    epoch: ids.epochB,
    capability: capabilityB,
  });

  const shortToken = await acquireLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerLongWrite,
    epoch: ids.epochA,
    capability: capabilityA,
    ttlMs: 30_000,
  });
  const shortWrite = await runtimePool.connect();
  try {
    await shortWrite.query('BEGIN');
    await beginMutation(shortWrite, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      ownerId: ids.ownerLongWrite,
      token: shortToken,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    const renewStartedAt = Date.now();
    const renewal = renewLease({
      sessionId: ids.sessionA,
      ownerId: ids.ownerLongWrite,
      token: shortToken,
      epoch: ids.epochA,
      capability: capabilityA,
      ttlMs: 30_000,
    });
    const renewalState = await Promise.race([
      renewal.then(() => 'completed'),
      delay(150).then(() => 'blocked'),
    ]);
    assert.equal(renewalState, 'blocked');
    await shortWrite.query('COMMIT');
    await renewal;
    log('renew_waited_for_write_transaction', {
      blocked_ms_at_least: 150,
      elapsed_ms: Date.now() - renewStartedAt,
    });
  } finally {
    await shortWrite.query('ROLLBACK').catch(() => undefined);
    shortWrite.release();
  }
  await releaseLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerLongWrite,
    token: shortToken,
    epoch: ids.epochA,
    capability: capabilityA,
  });

  // A renewal that starts while the lease is valid but waits behind an
  // in-flight write until after expiry must fail. Sampling clock_timestamp()
  // at function entry would incorrectly revive the expired writer.
  const expiringRenewToken = await acquireLease({
    sessionId: ids.sessionB,
    ownerId: ids.ownerLongWrite,
    epoch: ids.epochB,
    capability: capabilityB,
    ttlMs: 5_000,
  });
  const expiringRenewWrite = await runtimePool.connect();
  try {
    await expiringRenewWrite.query('BEGIN');
    await beginMutation(expiringRenewWrite, {
      sessionId: ids.sessionB,
      revisionId: revisionB,
      ownerId: ids.ownerLongWrite,
      token: expiringRenewToken,
      epoch: ids.epochB,
      capability: capabilityB,
    });
    const renewalStartedAt = Date.now();
    const renewalOutcome = renewLease({
      sessionId: ids.sessionB,
      ownerId: ids.ownerLongWrite,
      token: expiringRenewToken,
      epoch: ids.epochB,
      capability: capabilityB,
      ttlMs: 5_000,
    }).then(
      (result) => ({ result }),
      (error) => ({ error })
    );
    const renewalState = await Promise.race([
      renewalOutcome.then(() => 'completed'),
      delay(150).then(() => 'blocked'),
    ]);
    assert.equal(renewalState, 'blocked');
    await delay(5_050);
    await expiringRenewWrite.query('COMMIT');
    const renewalResult = await renewalOutcome;
    assert.equal(
      renewalResult.error?.code,
      '55000',
      `renew crossing expiry unexpectedly succeeded after ${Date.now() - renewalStartedAt}ms`
    );
    log('renew_wait_crossed_expiry_and_lost', {
      elapsed_ms: Date.now() - renewalStartedAt,
    });
  } finally {
    await expiringRenewWrite.query('ROLLBACK').catch(() => undefined);
    expiringRenewWrite.release();
  }
  await releaseLease({
    sessionId: ids.sessionB,
    ownerId: ids.ownerLongWrite,
    token: expiringRenewToken,
    epoch: ids.epochB,
    capability: capabilityB,
  });

  const expiringToken = await acquireLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerLongWrite,
    epoch: ids.epochA,
    capability: capabilityA,
    ttlMs: 5_000,
  });
  const longWrite = await runtimePool.connect();
  try {
    await longWrite.query('BEGIN');
    await beginMutation(longWrite, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      ownerId: ids.ownerLongWrite,
      token: expiringToken,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    await longWrite.query(
      `UPDATE public.whatsapp_chat_settings
          SET muted_until = muted_until + 1
        WHERE session_id = $1::uuid
          AND revision_id = $2::bigint
          AND chat_jid = $3`,
      [ids.sessionA, revisionA.toString(), sharedChatJid]
    );
    const takeoverStartedAt = Date.now();
    const takeoverOutcome = acquireLease({
      sessionId: ids.sessionA,
      ownerId: ids.ownerTakeover,
      epoch: ids.epochA,
      capability: capabilityA,
      ttlMs: 30_000,
    }).then(
      (token) => ({ token }),
      (error) => ({ error })
    );
    const takeoverState = await Promise.race([
      takeoverOutcome.then(() => 'completed'),
      delay(150).then(() => 'blocked'),
    ]);
    assert.equal(takeoverState, 'blocked');
    await delay(5_050);
    await longWrite.query('COMMIT');
    const takeoverResult = await takeoverOutcome;
    if (takeoverResult.error) {
      throw takeoverResult.error;
    }
    const takeoverToken = takeoverResult.token;
    assert(takeoverToken > expiringToken);
    const takeoverTTL = await adminPool.query(
      `SELECT floor(extract(epoch FROM (expires_at - clock_timestamp())) * 1000)::bigint AS remaining_ms
         FROM public.whatsapp_session_lease
        WHERE session_id = $1::uuid`,
      [ids.sessionA]
    );
    assert(
      Number(takeoverTTL.rows[0].remaining_ms) >= 25_000,
      `takeover returned a stale/non-future TTL: ${takeoverTTL.rows[0].remaining_ms}ms`
    );

    await expectPostgresError(
      () =>
        renewLease({
          sessionId: ids.sessionA,
          ownerId: ids.ownerLongWrite,
          token: expiringToken,
          epoch: ids.epochA,
          capability: capabilityA,
        }),
      '55000'
    );
    await expectPostgresError(async () => {
      const staleClient = await runtimePool.connect();
      try {
        await staleClient.query('BEGIN');
        await beginMutation(staleClient, {
          sessionId: ids.sessionA,
          revisionId: revisionA,
          ownerId: ids.ownerLongWrite,
          token: expiringToken,
          epoch: ids.epochA,
          capability: capabilityA,
        });
      } finally {
        await staleClient.query('ROLLBACK').catch(() => undefined);
        staleClient.release();
      }
    }, '55000');
    log('takeover_fenced_stale_writer', {
      stale_token: expiringToken.toString(),
      takeover_token: takeoverToken.toString(),
      wait_crossed_expiry_ms: Date.now() - takeoverStartedAt,
      remaining_ms: Number(takeoverTTL.rows[0].remaining_ms),
    });
    await releaseLease({
      sessionId: ids.sessionA,
      ownerId: ids.ownerTakeover,
      token: takeoverToken,
      epoch: ids.epochA,
      capability: capabilityA,
    });
  } finally {
    await longWrite.query('ROLLBACK').catch(() => undefined);
    longWrite.release();
  }

  const gcToken = await acquireLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerA,
    epoch: ids.epochA,
    capability: capabilityA,
  });
  const gcClient = await runtimePool.connect();
  try {
    await gcClient.query('BEGIN');
    await beginMutation(gcClient, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      ownerId: ids.ownerA,
      token: gcToken,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    const gcResults = [];
    for (const [statement, params] of [
      [
        `DELETE FROM public.whatsapp_privacy_tokens
          WHERE session_id = $1::uuid AND revision_id = $2::bigint
            AND timestamp < 200`,
        [ids.sessionA, revisionA.toString()],
      ],
      [
        `DELETE FROM public.whatsapp_event_buffer
          WHERE session_id = $1::uuid AND revision_id = $2::bigint
            AND insert_timestamp < 200`,
        [ids.sessionA, revisionA.toString()],
      ],
      [
        `DELETE FROM public.whatsapp_retry_buffer
          WHERE session_id = $1::uuid AND revision_id = $2::bigint
            AND timestamp < 200`,
        [ids.sessionA, revisionA.toString()],
      ],
    ]) {
      gcResults.push(await gcClient.query(statement, params));
    }
    assert.deepEqual(
      gcResults.map((result) => result.rowCount),
      [1, 1, 1]
    );
    await gcClient.query('COMMIT');
  } finally {
    await gcClient.query('ROLLBACK').catch(() => undefined);
    gcClient.release();
  }
  await releaseLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerA,
    token: gcToken,
    epoch: ids.epochA,
    capability: capabilityA,
  });
  assert.deepEqual(
    await snapshotCanonicalSession(ids.sessionB),
    canonicalSnapshotB
  );
  const afterGcA = await snapshotCanonicalSession(ids.sessionA);
  for (const table of [
    'whatsapp_privacy_tokens',
    'whatsapp_event_buffer',
    'whatsapp_retry_buffer',
  ]) {
    assert.equal(afterGcA[table].count, 0);
  }
  log('session_scoped_gc_verified', { sibling_hash_unchanged: true });

  const logoutToken = await acquireLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerA,
    epoch: ids.epochA,
    capability: capabilityA,
  });
  const logoutClient = await runtimePool.connect();
  try {
    await logoutClient.query('BEGIN');
    await beginMutation(logoutClient, {
      sessionId: ids.sessionA,
      revisionId: revisionA,
      ownerId: ids.ownerA,
      token: logoutToken,
      epoch: ids.epochA,
      capability: capabilityA,
    });
    const deleted = await logoutClient.query(
      `DELETE FROM public.whatsapp_device
        WHERE session_id = $1::uuid AND revision_id = $2::bigint`,
      [ids.sessionA, revisionA.toString()]
    );
    assert.equal(deleted.rowCount, 1);
    await logoutClient.query('COMMIT');
  } finally {
    await logoutClient.query('ROLLBACK').catch(() => undefined);
    logoutClient.release();
  }
  await releaseLease({
    sessionId: ids.sessionA,
    ownerId: ids.ownerA,
    token: logoutToken,
    epoch: ids.epochA,
    capability: capabilityA,
  });
  const afterLogoutA = await snapshotCanonicalSession(ids.sessionA);
  for (const table of canonicalStateTables) {
    assert.equal(
      afterLogoutA[table].count,
      table === 'whatsapp_provider_record' ? 1 : 0,
      `${table} after logout`
    );
  }
  assert.deepEqual(
    await snapshotCanonicalSession(ids.sessionB),
    canonicalSnapshotB
  );
  log('session_scoped_logout_verified', {
    child_rows_cascaded: true,
    sibling_hash_unchanged: true,
  });

  const bridgeClient = await adminPool.connect();
  try {
    await bridgeClient.query('BEGIN');
    await bridgeClient.query(
      `SELECT set_config('app.whatsapp_schema_upgrade_bridge', '17', true)`
    );
    const bridged = await bridgeClient.query(
      `INSERT INTO public.whatsapp_session_revision (
         session_id, provider, status, source, schema_version, codec_version,
         format, writer_generation, writer_epoch, capability_hash
       ) VALUES (
         $1::uuid, 'wwebjs', 'staging', 'handoff', 16, 1,
         'whatsapp-canonical-v1', 1, $2::uuid, $3
       )
       RETURNING schema_version, format`,
      [ids.sessionB, ids.epochB, capabilityHash(capabilityB)]
    );
    assert.deepEqual(bridged.rows, [
      { schema_version: 17, format: 'wwebjs-profile-manifest-v1' },
    ]);
    await bridgeClient.query('ROLLBACK');
  } finally {
    await bridgeClient.query('ROLLBACK').catch(() => undefined);
    bridgeClient.release();
  }
  log('wwebjs_handoff_format_bridge_verified', {
    target_format: 'wwebjs-profile-manifest-v1',
  });

  const deletedWorker = await adminPool.query(
    'DELETE FROM public.worker WHERE worker_id = $1::uuid',
    [ids.sessionA]
  );
  assert.equal(deletedWorker.rowCount, 1);
  const afterWorkerDeleteA = await snapshotCanonicalSession(ids.sessionA);
  for (const table of canonicalStateTables) {
    assert.equal(afterWorkerDeleteA[table].count, 0, `${table} after cascade`);
  }
  const ownershipRowsA = await adminPool.query(
    `SELECT
       (SELECT count(*) FROM public.whatsapp_session WHERE session_id = $1::uuid)::integer AS sessions,
       (SELECT count(*) FROM public.whatsapp_session_revision WHERE session_id = $1::uuid)::integer AS revisions,
       (SELECT count(*) FROM public.whatsapp_session_lease WHERE session_id = $1::uuid)::integer AS leases`,
    [ids.sessionA]
  );
  assert.deepEqual(ownershipRowsA.rows, [
    { sessions: 0, revisions: 0, leases: 0 },
  ]);
  assert.deepEqual(
    await snapshotCanonicalSession(ids.sessionB),
    canonicalSnapshotB
  );
  log('worker_cascade_isolation_verified', {
    deleted_session: true,
    sibling_hash_unchanged: true,
  });

  const sessionPathAdvisoryLocks = await adminPool.query(
    `SELECT count(*)::integer AS count
       FROM pg_catalog.pg_locks
      WHERE locktype = 'advisory'
        AND database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())`
  );
  assert.equal(sessionPathAdvisoryLocks.rows[0].count, 0);
  log('complete', { session_path_advisory_locks: 0 });
} finally {
  if (fixturesSeeded) {
    await cleanupFixtures();
  }
  await runtimePool.end();
  await adminPool.end();
}
