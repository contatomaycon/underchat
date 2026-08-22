import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { whatsappSessionRevision } from './workerWhatsappSession.model';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const whatsappStoreVersion = pgTable(
  'whatsapp_store_version',
  {
    version: integer().notNull(),
    compat: integer().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_store_version_pk',
      columns: [table.version],
    }),
    check(
      'whatsapp_store_version_single_supported_check',
      sql`${table.version} = 17 AND ${table.compat} = 17`
    ),
  ]
);

export const whatsappDevice = pgTable(
  'whatsapp_device',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    jid: text(),
    lid: text(),
    facebook_uuid: uuid(),
    registration_id: bigint({ mode: 'number' }),
    noise_key: bytea(),
    identity_key: bytea(),
    signed_pre_key: bytea(),
    signed_pre_key_id: integer(),
    signed_pre_key_sig: bytea(),
    adv_key: bytea(),
    adv_secret_available: boolean().notNull().default(false),
    adv_details: bytea(),
    adv_account_sig: bytea(),
    adv_account_sig_key: bytea(),
    adv_device_sig: bytea(),
    platform: text().notNull().default(''),
    business_name: text().notNull().default(''),
    push_name: text().notNull().default(''),
    lid_migration_ts: bigint({ mode: 'number' }).notNull().default(0),
    next_pre_key_id: integer().notNull().default(1),
    device_fingerprint: bytea(),
    fingerprint_version: text(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_device_pk',
      columns: [table.session_id, table.revision_id],
    }),
    foreignKey({
      name: 'whatsapp_device_revision_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [
        whatsappSessionRevision.session_id,
        whatsappSessionRevision.revision_id,
      ],
    }).onDelete('cascade'),
    index('whatsapp_device_jid_session_idx')
      .on(table.jid, table.session_id)
      .where(sql`${table.jid} IS NOT NULL`),
    check(
      'whatsapp_device_registration_id_check',
      sql`${table.registration_id} IS NULL OR (${table.registration_id} >= 0 AND ${table.registration_id} < 4294967296)`
    ),
    check(
      'whatsapp_device_noise_key_check',
      sql`${table.noise_key} IS NULL OR octet_length(${table.noise_key}) = 32`
    ),
    check(
      'whatsapp_device_identity_key_check',
      sql`${table.identity_key} IS NULL OR octet_length(${table.identity_key}) = 32`
    ),
    check(
      'whatsapp_device_signed_pre_key_check',
      sql`${table.signed_pre_key} IS NULL OR octet_length(${table.signed_pre_key}) = 32`
    ),
    check(
      'whatsapp_device_signed_pre_key_id_check',
      sql`${table.signed_pre_key_id} IS NULL OR (${table.signed_pre_key_id} >= 0 AND ${table.signed_pre_key_id} < 16777216)`
    ),
    check(
      'whatsapp_device_signed_pre_key_sig_check',
      sql`${table.signed_pre_key_sig} IS NULL OR octet_length(${table.signed_pre_key_sig}) = 64`
    ),
    check(
      'whatsapp_device_adv_account_sig_check',
      sql`${table.adv_account_sig} IS NULL OR octet_length(${table.adv_account_sig}) = 64`
    ),
    check(
      'whatsapp_device_adv_account_sig_key_check',
      sql`${table.adv_account_sig_key} IS NULL OR octet_length(${table.adv_account_sig_key}) = 32`
    ),
    check(
      'whatsapp_device_adv_device_sig_check',
      sql`${table.adv_device_sig} IS NULL OR octet_length(${table.adv_device_sig}) = 64`
    ),
    check(
      'whatsapp_device_adv_details_size_check',
      sql`${table.adv_details} IS NULL OR octet_length(${table.adv_details}) BETWEEN 1 AND 1048576`
    ),
    check(
      'whatsapp_device_native_credentials_complete_check',
      sql`num_nonnulls(${table.registration_id}, ${table.noise_key}, ${table.identity_key}, ${table.signed_pre_key}, ${table.signed_pre_key_id}, ${table.signed_pre_key_sig}, ${table.adv_details}, ${table.adv_account_sig}, ${table.adv_account_sig_key}, ${table.adv_device_sig}) = 0 OR num_nulls(${table.registration_id}, ${table.noise_key}, ${table.identity_key}, ${table.signed_pre_key}, ${table.signed_pre_key_id}, ${table.signed_pre_key_sig}, ${table.adv_details}, ${table.adv_account_sig}, ${table.adv_account_sig_key}, ${table.adv_device_sig}) = 0`
    ),
    check(
      'whatsapp_device_adv_secret_check',
      sql`(${table.adv_secret_available} AND ${table.adv_key} IS NOT NULL AND octet_length(${table.adv_key}) = 32 AND num_nulls(${table.registration_id}, ${table.noise_key}, ${table.identity_key}, ${table.signed_pre_key}, ${table.signed_pre_key_id}, ${table.signed_pre_key_sig}, ${table.adv_details}, ${table.adv_account_sig}, ${table.adv_account_sig_key}, ${table.adv_device_sig}) = 0) OR (NOT ${table.adv_secret_available} AND ${table.adv_key} IS NULL)`
    ),
    check(
      'whatsapp_device_pre_key_counter_check',
      sql`${table.next_pre_key_id} > 0 AND ${table.next_pre_key_id} <= 16777216`
    ),
    check(
      'whatsapp_device_fingerprint_check',
      sql`(${table.device_fingerprint} IS NULL AND ${table.fingerprint_version} IS NULL) OR (${table.device_fingerprint} IS NOT NULL AND ${table.fingerprint_version} IS NOT NULL AND octet_length(${table.device_fingerprint}) = 32 AND ${table.fingerprint_version} IN ('underchat-whatsapp-device-fingerprint-v1', 'underchat-whatsapp-device-fingerprint-v2') AND num_nulls(${table.registration_id}, ${table.noise_key}, ${table.identity_key}, ${table.signed_pre_key}, ${table.signed_pre_key_id}, ${table.signed_pre_key_sig}, ${table.adv_details}, ${table.adv_account_sig}, ${table.adv_account_sig_key}, ${table.adv_device_sig}) = 0)`
    ),
  ]
);

export const whatsappIdentityKeys = pgTable(
  'whatsapp_identity_keys',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    their_id: text().notNull(),
    identity: bytea().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_identity_keys_pk',
      columns: [table.session_id, table.revision_id, table.their_id],
    }),
    foreignKey({
      name: 'whatsapp_identity_keys_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_identity_keys_identity_check',
      sql`octet_length(${table.identity}) = 32`
    ),
  ]
);

export const whatsappPreKeys = pgTable(
  'whatsapp_pre_keys',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    key_id: integer().notNull(),
    key: bytea().notNull(),
    uploaded: boolean().notNull().default(false),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_pre_keys_pk',
      columns: [table.session_id, table.revision_id, table.key_id],
    }),
    foreignKey({
      name: 'whatsapp_pre_keys_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    index('whatsapp_pre_keys_pending_idx')
      .on(table.session_id, table.revision_id, table.key_id)
      .where(sql`${table.uploaded} = false`),
    check(
      'whatsapp_pre_keys_key_id_check',
      sql`${table.key_id} >= 0 AND ${table.key_id} < 16777216`
    ),
    check('whatsapp_pre_keys_key_check', sql`octet_length(${table.key}) = 32`),
  ]
);

export type WhatsappPqPreKeyKind = 'one_time' | 'last_resort';

export const whatsappPqPreKeys = pgTable(
  'whatsapp_pq_pre_keys',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    key_id: integer().notNull(),
    key_kind: text().$type<WhatsappPqPreKeyKind>().notNull(),
    public_key: bytea().notNull(),
    private_key: bytea().notNull(),
    signature: bytea().notNull(),
    timestamp_ms: bigint({ mode: 'number' }).notNull(),
    sent_to_server: boolean().notNull().default(false),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_pq_pre_keys_pk',
      columns: [table.session_id, table.revision_id, table.key_id],
    }),
    foreignKey({
      name: 'whatsapp_pq_pre_keys_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    uniqueIndex('whatsapp_pq_pre_keys_last_resort_uidx')
      .on(table.session_id, table.revision_id)
      .where(sql`${table.key_kind} = 'last_resort'`),
    index('whatsapp_pq_pre_keys_pending_idx')
      .on(table.session_id, table.revision_id, table.key_id)
      .where(
        sql`${table.key_kind} = 'one_time' AND ${table.sent_to_server} = false`
      ),
    check(
      'whatsapp_pq_pre_keys_key_id_check',
      sql`${table.key_id} >= 0 AND ${table.key_id} < 16777215`
    ),
    check(
      'whatsapp_pq_pre_keys_kind_check',
      sql`${table.key_kind} IN ('one_time', 'last_resort')`
    ),
    check(
      'whatsapp_pq_pre_keys_public_key_check',
      sql`octet_length(${table.public_key}) = 1568`
    ),
    check(
      'whatsapp_pq_pre_keys_private_key_check',
      sql`octet_length(${table.private_key}) = 3168`
    ),
    check(
      'whatsapp_pq_pre_keys_signature_check',
      sql`octet_length(${table.signature}) = 64`
    ),
    check(
      'whatsapp_pq_pre_keys_timestamp_check',
      sql`${table.timestamp_ms} >= 0`
    ),
  ]
);

export const whatsappPqPreKeyState = pgTable(
  'whatsapp_pq_pre_key_state',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    codec_version: integer().notNull().default(1),
    algorithm: text().notNull().default('ML-KEM-1024'),
    next_pre_key_id: integer().notNull().default(1),
    migrated: boolean().notNull().default(false),
    last_server_count: integer(),
    last_server_count_timestamp_ms: bigint({ mode: 'number' }),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_pq_pre_key_state_pk',
      columns: [table.session_id, table.revision_id],
    }),
    foreignKey({
      name: 'whatsapp_pq_pre_key_state_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_pq_pre_key_state_codec_check',
      sql`${table.codec_version} = 1 AND ${table.algorithm} = 'ML-KEM-1024'`
    ),
    check(
      'whatsapp_pq_pre_key_state_allocator_check',
      sql`${table.next_pre_key_id} >= 0 AND ${table.next_pre_key_id} < 16777215`
    ),
    check(
      'whatsapp_pq_pre_key_state_server_count_check',
      sql`(${table.last_server_count} IS NULL AND ${table.last_server_count_timestamp_ms} IS NULL) OR (${table.last_server_count} IS NOT NULL AND ${table.last_server_count_timestamp_ms} IS NOT NULL AND ${table.last_server_count} >= 0 AND ${table.last_server_count_timestamp_ms} >= 0)`
    ),
  ]
);

export const whatsappSignalSessions = pgTable(
  'whatsapp_signal_sessions',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    their_id: text().notNull(),
    scope: text().notNull().default('default'),
    session: bytea(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_signal_sessions_pk',
      columns: [
        table.session_id,
        table.revision_id,
        table.their_id,
        table.scope,
      ],
    }),
    foreignKey({
      name: 'whatsapp_signal_sessions_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_signal_sessions_scope_check',
      sql`${table.scope} IN ('default', 'status', 'pq')`
    ),
    check(
      'whatsapp_signal_sessions_payload_check',
      sql`${table.session} IS NULL OR octet_length(${table.session}) BETWEEN 1 AND 8388608`
    ),
  ]
);

export const whatsappSenderKeys = pgTable(
  'whatsapp_sender_keys',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    chat_id: text().notNull(),
    sender_id: text().notNull(),
    sender_key: bytea().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_sender_keys_pk',
      columns: [
        table.session_id,
        table.revision_id,
        table.chat_id,
        table.sender_id,
      ],
    }),
    foreignKey({
      name: 'whatsapp_sender_keys_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_sender_keys_payload_check',
      sql`octet_length(${table.sender_key}) BETWEEN 1 AND 2097152`
    ),
  ]
);

export const whatsappAppStateSyncKeys = pgTable(
  'whatsapp_app_state_sync_keys',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    key_id: bytea().notNull(),
    key_data: bytea().notNull(),
    timestamp: bigint({ mode: 'number' }).notNull(),
    fingerprint: bytea().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_app_state_sync_keys_pk',
      columns: [table.session_id, table.revision_id, table.key_id],
    }),
    foreignKey({
      name: 'whatsapp_app_state_sync_keys_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    // Atlas keeps key_id as an INCLUDE column. The pinned Drizzle version
    // cannot express PostgreSQL INCLUDE indexes, so retain the key ordering
    // here without generating an incompatible model API call.
    index('whatsapp_app_state_sync_keys_latest_idx').on(
      table.session_id,
      table.revision_id,
      table.timestamp.desc()
    ),
    check(
      'whatsapp_app_state_sync_keys_payload_check',
      sql`octet_length(${table.key_id}) BETWEEN 1 AND 1048576 AND octet_length(${table.key_data}) BETWEEN 1 AND 1048576 AND octet_length(${table.fingerprint}) BETWEEN 1 AND 1048576`
    ),
  ]
);

export const whatsappAppStateVersion = pgTable(
  'whatsapp_app_state_version',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    name: text().notNull(),
    version: bigint({ mode: 'number' }).notNull(),
    hash: bytea().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_app_state_version_pk',
      columns: [table.session_id, table.revision_id, table.name],
    }),
    foreignKey({
      name: 'whatsapp_app_state_version_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_app_state_version_hash_check',
      sql`octet_length(${table.hash}) = 128`
    ),
  ]
);

export const whatsappAppStateMutationMacs = pgTable(
  'whatsapp_app_state_mutation_macs',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    name: text().notNull(),
    index_mac: bytea().notNull(),
    version: bigint({ mode: 'number' }).notNull(),
    value_mac: bytea().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_app_state_mutation_macs_pk',
      columns: [
        table.session_id,
        table.revision_id,
        table.name,
        table.index_mac,
        table.version,
      ],
    }),
    foreignKey({
      name: 'whatsapp_app_state_mutation_macs_version_fk',
      columns: [table.session_id, table.revision_id, table.name],
      foreignColumns: [
        whatsappAppStateVersion.session_id,
        whatsappAppStateVersion.revision_id,
        whatsappAppStateVersion.name,
      ],
    }).onDelete('cascade'),
    check(
      'whatsapp_app_state_mutation_macs_index_check',
      sql`octet_length(${table.index_mac}) = 32`
    ),
    check(
      'whatsapp_app_state_mutation_macs_value_check',
      sql`octet_length(${table.value_mac}) = 32`
    ),
  ]
);

export const whatsappContacts = pgTable(
  'whatsapp_contacts',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    their_jid: text().notNull(),
    first_name: text(),
    full_name: text(),
    push_name: text(),
    business_name: text(),
    redacted_phone: text(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_contacts_pk',
      columns: [table.session_id, table.revision_id, table.their_jid],
    }),
    foreignKey({
      name: 'whatsapp_contacts_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
  ]
);

export const whatsappChatSettings = pgTable(
  'whatsapp_chat_settings',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    chat_jid: text().notNull(),
    muted_until: bigint({ mode: 'number' }).notNull().default(0),
    pinned: boolean().notNull().default(false),
    archived: boolean().notNull().default(false),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_chat_settings_pk',
      columns: [table.session_id, table.revision_id, table.chat_jid],
    }),
    foreignKey({
      name: 'whatsapp_chat_settings_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
  ]
);

export const whatsappMessageSecrets = pgTable(
  'whatsapp_message_secrets',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    chat_jid: text().notNull(),
    sender_jid: text().notNull(),
    message_id: text().notNull(),
    key: bytea().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_message_secrets_pk',
      columns: [
        table.session_id,
        table.revision_id,
        table.chat_jid,
        table.sender_jid,
        table.message_id,
      ],
    }),
    foreignKey({
      name: 'whatsapp_message_secrets_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_message_secrets_payload_check',
      sql`octet_length(${table.key}) BETWEEN 1 AND 1048576`
    ),
  ]
);

export const whatsappPrivacyTokens = pgTable(
  'whatsapp_privacy_tokens',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    their_jid: text().notNull(),
    token: bytea().notNull(),
    timestamp: bigint({ mode: 'number' }).notNull(),
    sender_timestamp: bigint({ mode: 'number' }),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_privacy_tokens_pk',
      columns: [table.session_id, table.revision_id, table.their_jid],
    }),
    foreignKey({
      name: 'whatsapp_privacy_tokens_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    index('whatsapp_privacy_tokens_expiry_idx').on(
      table.session_id,
      table.revision_id,
      table.timestamp
    ),
    check(
      'whatsapp_privacy_tokens_payload_check',
      sql`octet_length(${table.token}) BETWEEN 1 AND 1048576`
    ),
  ]
);

export const whatsappNctSalt = pgTable(
  'whatsapp_nct_salt',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    salt: bytea().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_nct_salt_pk',
      columns: [table.session_id, table.revision_id],
    }),
    foreignKey({
      name: 'whatsapp_nct_salt_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    check(
      'whatsapp_nct_salt_payload_check',
      sql`octet_length(${table.salt}) BETWEEN 1 AND 1048576`
    ),
  ]
);

export const whatsappLidMap = pgTable(
  'whatsapp_lid_map',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    lid: text().notNull(),
    pn: text().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_lid_map_pk',
      columns: [table.session_id, table.revision_id, table.lid],
    }),
    foreignKey({
      name: 'whatsapp_lid_map_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    unique('whatsapp_lid_map_pn_unique').on(
      table.session_id,
      table.revision_id,
      table.pn
    ),
  ]
);

export const whatsappEventBuffer = pgTable(
  'whatsapp_event_buffer',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    ciphertext_hash: bytea().notNull(),
    plaintext: bytea(),
    server_timestamp: bigint({ mode: 'number' }).notNull(),
    insert_timestamp: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_event_buffer_pk',
      columns: [table.session_id, table.revision_id, table.ciphertext_hash],
    }),
    foreignKey({
      name: 'whatsapp_event_buffer_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    index('whatsapp_event_buffer_expiry_idx').on(
      table.session_id,
      table.revision_id,
      table.insert_timestamp
    ),
    check(
      'whatsapp_event_buffer_ciphertext_hash_check',
      sql`octet_length(${table.ciphertext_hash}) = 32`
    ),
    check(
      'whatsapp_event_buffer_plaintext_check',
      sql`${table.plaintext} IS NULL OR octet_length(${table.plaintext}) <= 8388608`
    ),
  ]
);

export const whatsappRetryBuffer = pgTable(
  'whatsapp_retry_buffer',
  {
    session_id: uuid().notNull(),
    revision_id: bigint({ mode: 'number' }).notNull(),
    chat_jid: text().notNull(),
    message_id: text().notNull(),
    format: text().notNull(),
    plaintext: bytea().notNull(),
    timestamp: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_retry_buffer_pk',
      columns: [
        table.session_id,
        table.revision_id,
        table.chat_jid,
        table.message_id,
      ],
    }),
    foreignKey({
      name: 'whatsapp_retry_buffer_device_fk',
      columns: [table.session_id, table.revision_id],
      foreignColumns: [whatsappDevice.session_id, whatsappDevice.revision_id],
    }).onDelete('cascade'),
    index('whatsapp_retry_buffer_expiry_idx').on(
      table.session_id,
      table.revision_id,
      table.timestamp
    ),
    check(
      'whatsapp_retry_buffer_plaintext_check',
      sql`octet_length(${table.plaintext}) <= 8388608`
    ),
  ]
);
