-- PostgreSQL-backed WhatsApp sessions. Existing channels and runtimes stay on
-- their named volumes; the final database default is used only by new rows.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "worker"
  ADD COLUMN "session_storage" character varying(20);

UPDATE "worker"
SET "session_storage" = 'legacy_volume'
WHERE "session_storage" IS NULL;

ALTER TABLE "worker"
  ALTER COLUMN "session_storage" SET DEFAULT 'postgres',
  ALTER COLUMN "session_storage" SET NOT NULL,
  ADD CONSTRAINT "worker_session_storage_check"
    CHECK ("session_storage" IN ('legacy_volume', 'postgres'));

CREATE INDEX "worker_session_storage_idx"
  ON "worker" ("session_storage");

ALTER TABLE "worker_runtime"
  ADD COLUMN "session_storage" character varying(20),
  ADD COLUMN "runtime_capability_hash" character varying(64),
  ADD COLUMN "session_writer_epoch" uuid;

UPDATE "worker_runtime"
SET "session_storage" = 'legacy_volume'
WHERE "session_storage" IS NULL;

UPDATE "worker_runtime"
SET "runtime_generation" = 1
WHERE "runtime_generation" <= 0;

ALTER TABLE "worker_runtime"
  ALTER COLUMN "session_storage" SET DEFAULT 'postgres',
  ALTER COLUMN "session_storage" SET NOT NULL,
  ALTER COLUMN "session_volume_name" DROP NOT NULL,
  ADD CONSTRAINT "worker_runtime_generation_positive_check"
    CHECK ("runtime_generation" > 0),
  ADD CONSTRAINT "worker_runtime_session_backend_check"
    CHECK (
      (
        "session_storage" = 'legacy_volume'
        AND "session_volume_name" IS NOT NULL
      )
      OR (
        "session_storage" = 'postgres'
        AND "session_volume_name" IS NULL
      )
    ),
  ADD CONSTRAINT "worker_runtime_capability_hash_check"
    CHECK (
      "runtime_capability_hash" IS NULL
      OR "runtime_capability_hash" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "worker_runtime_writer_identity_pair_check"
    CHECK (
      ("runtime_capability_hash" IS NULL AND "session_writer_epoch" IS NULL)
      OR
      ("runtime_capability_hash" IS NOT NULL AND "session_writer_epoch" IS NOT NULL)
    );

CREATE INDEX "worker_runtime_session_storage_idx"
  ON "worker_runtime" ("session_storage");

ALTER TABLE "worker_warm_pool"
  ADD COLUMN "session_storage" character varying(20),
  ADD COLUMN "runtime_generation" integer NOT NULL DEFAULT 1,
  ADD COLUMN "runtime_capability_hash" character varying(64),
  ADD COLUMN "session_writer_epoch" uuid;

UPDATE "worker_warm_pool"
SET "session_storage" = 'legacy_volume'
WHERE "session_storage" IS NULL;

ALTER TABLE "worker_warm_pool"
  ALTER COLUMN "session_storage" SET DEFAULT 'postgres',
  ALTER COLUMN "session_storage" SET NOT NULL,
  ALTER COLUMN "session_volume_name" DROP NOT NULL,
  ADD CONSTRAINT "worker_warm_pool_runtime_generation_positive_check"
    CHECK ("runtime_generation" > 0),
  ADD CONSTRAINT "worker_warm_pool_session_backend_check"
    CHECK (
      (
        "session_storage" = 'legacy_volume'
        AND "session_volume_name" IS NOT NULL
      )
      OR (
        "session_storage" = 'postgres'
        AND "session_volume_name" IS NULL
      )
    ),
  ADD CONSTRAINT "worker_warm_pool_capability_hash_check"
    CHECK (
      "runtime_capability_hash" IS NULL
      OR "runtime_capability_hash" ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT "worker_warm_pool_writer_identity_pair_check"
    CHECK (
      ("runtime_capability_hash" IS NULL AND "session_writer_epoch" IS NULL)
      OR
      ("runtime_capability_hash" IS NOT NULL AND "session_writer_epoch" IS NOT NULL)
    );

CREATE INDEX "worker_warm_pool_session_storage_idx"
  ON "worker_warm_pool" ("session_storage");

CREATE TABLE "worker_whatsapp_session_revision" (
  "worker_id" uuid NOT NULL,
  "revision_id" bigserial NOT NULL,
  "provider" character varying(20) NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'staging',
  "source" character varying(30) NOT NULL,
  "format" character varying(50) NOT NULL,
  "checksum_sha256" character varying(64),
  "size_bytes" bigint NOT NULL DEFAULT 0,
  "writer_generation" integer NOT NULL,
  "writer_epoch" uuid NOT NULL,
  "capability_hash" character varying(64) NOT NULL,
  "error_code" character varying(100),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "persisted_at" timestamptz,
  "validated_at" timestamptz,
  "promoted_at" timestamptz,
  "retired_at" timestamptz,
  CONSTRAINT "worker_whatsapp_session_revision_pk"
    PRIMARY KEY ("worker_id", "revision_id"),
  CONSTRAINT "worker_whatsapp_session_revision_worker_fk"
    FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id")
    ON DELETE CASCADE,
  CONSTRAINT "worker_whatsapp_session_revision_provider_check"
    CHECK ("provider" IN ('baileys', 'wwebjs', 'whatsmeow')),
  CONSTRAINT "worker_whatsapp_session_revision_status_check"
    CHECK ("status" IN ('staging', 'ready', 'failed', 'retired')),
  CONSTRAINT "worker_whatsapp_session_revision_source_check"
    CHECK ("source" IN ('pairing', 'checkpoint', 'secure_import', 'rollback')),
  CONSTRAINT "worker_whatsapp_session_revision_size_check"
    CHECK ("size_bytes" >= 0),
  CONSTRAINT "worker_whatsapp_session_revision_generation_check"
    CHECK ("writer_generation" > 0),
  CONSTRAINT "worker_whatsapp_session_revision_checksum_check"
    CHECK (
      "checksum_sha256" IS NULL
      OR "checksum_sha256" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "worker_whatsapp_session_revision_capability_check"
    CHECK ("capability_hash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "worker_whatsapp_session_revision_status_idx"
  ON "worker_whatsapp_session_revision"
  ("worker_id", "status", "created_at");
CREATE INDEX "worker_whatsapp_session_revision_created_at_idx"
  ON "worker_whatsapp_session_revision" ("created_at");

CREATE TABLE "worker_whatsapp_session" (
  "worker_id" uuid PRIMARY KEY NOT NULL,
  "provider" character varying(20) NOT NULL,
  "state" character varying(20) NOT NULL DEFAULT 'empty',
  "active_revision_id" bigint,
  "previous_revision_id" bigint,
  "writer_generation" integer NOT NULL DEFAULT 1,
  "writer_epoch" uuid,
  "capability_hash" character varying(64),
  "last_persisted_at" timestamptz,
  "last_error_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "worker_whatsapp_session_worker_fk"
    FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id")
    ON DELETE CASCADE,
  CONSTRAINT "worker_whatsapp_session_active_revision_fk"
    FOREIGN KEY ("worker_id", "active_revision_id")
    REFERENCES "worker_whatsapp_session_revision"
    ("worker_id", "revision_id") ON DELETE RESTRICT,
  CONSTRAINT "worker_whatsapp_session_previous_revision_fk"
    FOREIGN KEY ("worker_id", "previous_revision_id")
    REFERENCES "worker_whatsapp_session_revision"
    ("worker_id", "revision_id") ON DELETE RESTRICT,
  CONSTRAINT "worker_whatsapp_session_provider_check"
    CHECK ("provider" IN ('baileys', 'wwebjs', 'whatsmeow')),
  CONSTRAINT "worker_whatsapp_session_state_check"
    CHECK ("state" IN ('empty', 'importing', 'ready', 'error')),
  CONSTRAINT "worker_whatsapp_session_generation_check"
    CHECK ("writer_generation" > 0),
  CONSTRAINT "worker_whatsapp_session_revision_distinct_check"
    CHECK (
      "active_revision_id" IS NULL
      OR "previous_revision_id" IS NULL
      OR "active_revision_id" <> "previous_revision_id"
    ),
  CONSTRAINT "worker_whatsapp_session_capability_check"
    CHECK (
      "capability_hash" IS NULL
      OR "capability_hash" ~ '^[0-9a-f]{64}$'
    )
);

CREATE INDEX "worker_whatsapp_session_provider_state_idx"
  ON "worker_whatsapp_session" ("provider", "state");

CREATE TABLE "worker_baileys_session_record" (
  "worker_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "category" character varying(100) NOT NULL,
  "record_key" character varying(500) NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "worker_baileys_session_record_pk"
    PRIMARY KEY ("worker_id", "revision_id", "category", "record_key"),
  CONSTRAINT "worker_baileys_session_record_revision_fk"
    FOREIGN KEY ("worker_id", "revision_id")
    REFERENCES "worker_whatsapp_session_revision"
    ("worker_id", "revision_id") ON DELETE CASCADE
);

CREATE INDEX "worker_baileys_session_record_revision_idx"
  ON "worker_baileys_session_record" ("worker_id", "revision_id");

CREATE TABLE "worker_wwebjs_session_snapshot" (
  "worker_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "checksum_sha256" character varying(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "chunk_count" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "persisted_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "worker_wwebjs_session_snapshot_pk"
    PRIMARY KEY ("worker_id", "revision_id"),
  CONSTRAINT "worker_wwebjs_session_snapshot_revision_fk"
    FOREIGN KEY ("worker_id", "revision_id")
    REFERENCES "worker_whatsapp_session_revision"
    ("worker_id", "revision_id") ON DELETE CASCADE,
  CONSTRAINT "worker_wwebjs_session_snapshot_checksum_check"
    CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "worker_wwebjs_session_snapshot_size_check"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 268435456),
  CONSTRAINT "worker_wwebjs_session_snapshot_chunk_count_check"
    CHECK ("chunk_count" > 0 AND "chunk_count" <= 256)
);

CREATE TABLE "worker_wwebjs_session_chunk" (
  "worker_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "chunk_index" integer NOT NULL,
  "payload" bytea NOT NULL,
  CONSTRAINT "worker_wwebjs_session_chunk_pk"
    PRIMARY KEY ("worker_id", "revision_id", "chunk_index"),
  CONSTRAINT "worker_wwebjs_session_chunk_snapshot_fk"
    FOREIGN KEY ("worker_id", "revision_id")
    REFERENCES "worker_wwebjs_session_snapshot"
    ("worker_id", "revision_id") ON DELETE CASCADE,
  CONSTRAINT "worker_wwebjs_session_chunk_index_check"
    CHECK ("chunk_index" >= 0),
  CONSTRAINT "worker_wwebjs_session_chunk_payload_check"
    CHECK (octet_length("payload") > 0 AND octet_length("payload") <= 1048576)
);

CREATE TABLE "worker_whatsmeow_session_backup" (
  "worker_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "checksum_sha256" character varying(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "chunk_count" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "worker_whatsmeow_session_backup_pk"
    PRIMARY KEY ("worker_id", "revision_id"),
  CONSTRAINT "worker_whatsmeow_session_backup_revision_fk"
    FOREIGN KEY ("worker_id", "revision_id")
    REFERENCES "worker_whatsapp_session_revision"
    ("worker_id", "revision_id") ON DELETE CASCADE,
  CONSTRAINT "worker_whatsmeow_session_backup_checksum_check"
    CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "worker_whatsmeow_session_backup_size_check"
    CHECK ("size_bytes" > 0),
  CONSTRAINT "worker_whatsmeow_session_backup_chunk_count_check"
    CHECK ("chunk_count" > 0)
);

CREATE TABLE "worker_whatsmeow_session_backup_chunk" (
  "worker_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "chunk_index" integer NOT NULL,
  "payload" bytea NOT NULL,
  CONSTRAINT "worker_whatsmeow_session_backup_chunk_pk"
    PRIMARY KEY ("worker_id", "revision_id", "chunk_index"),
  CONSTRAINT "worker_whatsmeow_session_backup_chunk_backup_fk"
    FOREIGN KEY ("worker_id", "revision_id")
    REFERENCES "worker_whatsmeow_session_backup"
    ("worker_id", "revision_id") ON DELETE CASCADE,
  CONSTRAINT "worker_whatsmeow_session_backup_chunk_index_check"
    CHECK ("chunk_index" >= 0),
  CONSTRAINT "worker_whatsmeow_session_backup_chunk_payload_check"
    CHECK (octet_length("payload") > 0 AND octet_length("payload") <= 1048576)
);

CREATE TABLE "worker_runtime_event_outbox" (
  "outbox_id" bigserial NOT NULL,
  "event_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "provider" character varying(20) NOT NULL,
  "container_id" character varying(100) NOT NULL,
  "runtime_generation" integer NOT NULL,
  "writer_epoch" uuid NOT NULL,
  "connection_sequence" bigint NOT NULL,
  "capability_hash" character varying(64) NOT NULL,
  "event_type" character varying(50) NOT NULL,
  "payload" jsonb NOT NULL,
  "state" character varying(20) NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "lease_owner" uuid,
  "lease_expires_at" timestamptz,
  "last_error" character varying(1000),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz,
  CONSTRAINT "worker_runtime_event_outbox_pk" PRIMARY KEY ("outbox_id"),
  CONSTRAINT "worker_runtime_event_outbox_worker_fk"
    FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id")
    ON DELETE CASCADE,
  CONSTRAINT "worker_runtime_event_outbox_account_worker_fk"
    FOREIGN KEY ("account_id", "worker_id")
    REFERENCES "worker" ("account_id", "worker_id") ON DELETE CASCADE,
  CONSTRAINT "worker_runtime_event_outbox_provider_check"
    CHECK ("provider" IN ('baileys', 'wwebjs', 'whatsmeow')),
  CONSTRAINT "worker_runtime_event_outbox_state_check"
    CHECK ("state" IN ('pending', 'publishing', 'published', 'dead_letter')),
  CONSTRAINT "worker_runtime_event_outbox_event_type_check"
    CHECK ("event_type" IN ('status', 'telemetry')),
  CONSTRAINT "worker_runtime_event_outbox_payload_object_check"
    CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "worker_runtime_event_outbox_generation_check"
    CHECK ("runtime_generation" > 0 AND "connection_sequence" >= 0),
  CONSTRAINT "worker_runtime_event_outbox_capability_check"
    CHECK ("capability_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "worker_runtime_event_outbox_attempt_check"
    CHECK ("attempt_count" >= 0)
);

CREATE UNIQUE INDEX "worker_runtime_event_outbox_event_id_uidx"
  ON "worker_runtime_event_outbox" ("event_id");
CREATE INDEX "worker_runtime_event_outbox_pending_idx"
  ON "worker_runtime_event_outbox" ("available_at", "outbox_id")
  WHERE "state" = 'pending';
CREATE INDEX "worker_runtime_event_outbox_unpublished_worker_idx"
  ON "worker_runtime_event_outbox" ("worker_id", "outbox_id")
  WHERE "state" IN ('pending', 'publishing');
CREATE INDEX "worker_runtime_event_outbox_published_retention_idx"
  ON "worker_runtime_event_outbox" ("published_at", "outbox_id")
  WHERE "state" = 'published';
CREATE INDEX "worker_runtime_event_outbox_dead_letter_retention_idx"
  ON "worker_runtime_event_outbox" ("created_at", "outbox_id")
  WHERE "state" = 'dead_letter';
CREATE INDEX "worker_runtime_event_outbox_worker_created_idx"
  ON "worker_runtime_event_outbox" ("worker_id", "created_at");

CREATE TABLE "worker_self_heal_request" (
  "request_id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "request_key" character varying(255) NOT NULL,
  "worker_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "provider" character varying(20) NOT NULL,
  "container_id" character varying(100) NOT NULL,
  "runtime_generation" integer NOT NULL,
  "writer_epoch" uuid NOT NULL,
  "capability_hash" character varying(64) NOT NULL,
  "reason" character varying(100) NOT NULL,
  "evidence" jsonb NOT NULL,
  "state" character varying(20) NOT NULL DEFAULT 'queued',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "lease_owner" uuid,
  "lease_expires_at" timestamptz,
  "last_error" character varying(1000),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "dispatched_at" timestamptz,
  "completed_at" timestamptz,
  CONSTRAINT "worker_self_heal_request_worker_fk"
    FOREIGN KEY ("worker_id") REFERENCES "worker" ("worker_id")
    ON DELETE CASCADE,
  CONSTRAINT "worker_self_heal_request_account_worker_fk"
    FOREIGN KEY ("account_id", "worker_id")
    REFERENCES "worker" ("account_id", "worker_id") ON DELETE CASCADE,
  CONSTRAINT "worker_self_heal_request_provider_check"
    CHECK ("provider" IN ('baileys', 'wwebjs', 'whatsmeow')),
  CONSTRAINT "worker_self_heal_request_state_check"
    CHECK ("state" IN ('queued', 'processing', 'dispatched', 'completed', 'cancelled')),
  CONSTRAINT "worker_self_heal_request_generation_check"
    CHECK ("runtime_generation" > 0),
  CONSTRAINT "worker_self_heal_request_capability_check"
    CHECK ("capability_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "worker_self_heal_request_attempt_check"
    CHECK ("attempt_count" >= 0)
);

CREATE INDEX "worker_self_heal_request_key_idx"
  ON "worker_self_heal_request" ("request_key");
CREATE UNIQUE INDEX "worker_self_heal_request_active_uidx"
  ON "worker_self_heal_request"
  ("worker_id", "runtime_generation", "capability_hash", "reason")
  WHERE "state" IN ('queued', 'processing', 'dispatched');
CREATE INDEX "worker_self_heal_request_claim_idx"
  ON "worker_self_heal_request"
  ("available_at", "created_at", "request_id")
  WHERE "state" = 'queued';
CREATE INDEX "worker_self_heal_request_processing_lease_idx"
  ON "worker_self_heal_request"
  ("lease_expires_at", "created_at", "request_id")
  WHERE "state" = 'processing';

-- Whatsmeow SQLStore v15. Atlas owns these tables in the shared PostgreSQL;
-- workers validate the version row and never run sqlstore.Upgrade here.
CREATE TABLE "whatsmeow_version" (
  "version" integer NOT NULL,
  "compat" integer NOT NULL,
  CONSTRAINT "whatsmeow_version_single_supported_check"
    CHECK ("version" = 15 AND "compat" = 8)
);

INSERT INTO "whatsmeow_version" ("version", "compat") VALUES (15, 8);

CREATE TABLE "whatsmeow_device" (
  "jid" text PRIMARY KEY NOT NULL,
  "session_id" uuid NOT NULL,
  "lid" text,
  "facebook_uuid" uuid,
  "registration_id" bigint NOT NULL,
  "noise_key" bytea NOT NULL,
  "identity_key" bytea NOT NULL,
  "signed_pre_key" bytea NOT NULL,
  "signed_pre_key_id" integer NOT NULL,
  "signed_pre_key_sig" bytea NOT NULL,
  "adv_key" bytea NOT NULL,
  "adv_details" bytea NOT NULL,
  "adv_account_sig" bytea NOT NULL,
  "adv_account_sig_key" bytea NOT NULL,
  "adv_device_sig" bytea NOT NULL,
  "platform" text NOT NULL DEFAULT '',
  "business_name" text NOT NULL DEFAULT '',
  "push_name" text NOT NULL DEFAULT '',
  "lid_migration_ts" bigint NOT NULL DEFAULT 0,
  CONSTRAINT "whatsmeow_device_session_fk"
    FOREIGN KEY ("session_id") REFERENCES "worker" ("worker_id")
    ON DELETE CASCADE,
  CONSTRAINT "whatsmeow_device_registration_id_check"
    CHECK ("registration_id" >= 0 AND "registration_id" < 4294967296),
  CONSTRAINT "whatsmeow_device_noise_key_check"
    CHECK (octet_length("noise_key") = 32),
  CONSTRAINT "whatsmeow_device_identity_key_check"
    CHECK (octet_length("identity_key") = 32),
  CONSTRAINT "whatsmeow_device_signed_pre_key_check"
    CHECK (octet_length("signed_pre_key") = 32),
  CONSTRAINT "whatsmeow_device_signed_pre_key_id_check"
    CHECK ("signed_pre_key_id" >= 0 AND "signed_pre_key_id" < 16777216),
  CONSTRAINT "whatsmeow_device_signed_pre_key_sig_check"
    CHECK (octet_length("signed_pre_key_sig") = 64),
  CONSTRAINT "whatsmeow_device_adv_account_sig_check"
    CHECK (octet_length("adv_account_sig") = 64),
  CONSTRAINT "whatsmeow_device_adv_account_sig_key_check"
    CHECK (octet_length("adv_account_sig_key") = 32),
  CONSTRAINT "whatsmeow_device_adv_device_sig_check"
    CHECK (octet_length("adv_device_sig") = 64)
);

CREATE UNIQUE INDEX "whatsmeow_device_session_id_uidx"
  ON "whatsmeow_device" ("session_id");

CREATE TABLE "whatsmeow_identity_keys" (
  "our_jid" text NOT NULL,
  "their_id" text NOT NULL,
  "identity" bytea NOT NULL,
  CONSTRAINT "whatsmeow_identity_keys_pk"
    PRIMARY KEY ("our_jid", "their_id"),
  CONSTRAINT "whatsmeow_identity_keys_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsmeow_identity_keys_identity_check"
    CHECK (octet_length("identity") = 32)
);

CREATE TABLE "whatsmeow_pre_keys" (
  "jid" text NOT NULL,
  "key_id" integer NOT NULL,
  "key" bytea NOT NULL,
  "uploaded" boolean NOT NULL,
  CONSTRAINT "whatsmeow_pre_keys_pk" PRIMARY KEY ("jid", "key_id"),
  CONSTRAINT "whatsmeow_pre_keys_device_fk"
    FOREIGN KEY ("jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsmeow_pre_keys_key_id_check"
    CHECK ("key_id" >= 0 AND "key_id" < 16777216),
  CONSTRAINT "whatsmeow_pre_keys_key_check"
    CHECK (octet_length("key") = 32)
);

CREATE TABLE "whatsmeow_sessions" (
  "our_jid" text NOT NULL,
  "their_id" text NOT NULL,
  "session" bytea,
  CONSTRAINT "whatsmeow_sessions_pk"
    PRIMARY KEY ("our_jid", "their_id"),
  CONSTRAINT "whatsmeow_sessions_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "whatsmeow_sender_keys" (
  "our_jid" text NOT NULL,
  "chat_id" text NOT NULL,
  "sender_id" text NOT NULL,
  "sender_key" bytea NOT NULL,
  CONSTRAINT "whatsmeow_sender_keys_pk"
    PRIMARY KEY ("our_jid", "chat_id", "sender_id"),
  CONSTRAINT "whatsmeow_sender_keys_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "whatsmeow_app_state_sync_keys" (
  "jid" text NOT NULL,
  "key_id" bytea NOT NULL,
  "key_data" bytea NOT NULL,
  "timestamp" bigint NOT NULL,
  "fingerprint" bytea NOT NULL,
  CONSTRAINT "whatsmeow_app_state_sync_keys_pk"
    PRIMARY KEY ("jid", "key_id"),
  CONSTRAINT "whatsmeow_app_state_sync_keys_device_fk"
    FOREIGN KEY ("jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "whatsmeow_app_state_version" (
  "jid" text NOT NULL,
  "name" text NOT NULL,
  "version" bigint NOT NULL,
  "hash" bytea NOT NULL,
  CONSTRAINT "whatsmeow_app_state_version_pk"
    PRIMARY KEY ("jid", "name"),
  CONSTRAINT "whatsmeow_app_state_version_device_fk"
    FOREIGN KEY ("jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsmeow_app_state_version_hash_check"
    CHECK (octet_length("hash") = 128)
);

CREATE TABLE "whatsmeow_app_state_mutation_macs" (
  "jid" text NOT NULL,
  "name" text NOT NULL,
  "version" bigint NOT NULL,
  "index_mac" bytea NOT NULL,
  "value_mac" bytea NOT NULL,
  CONSTRAINT "whatsmeow_app_state_mutation_macs_pk"
    PRIMARY KEY ("jid", "name", "version", "index_mac"),
  CONSTRAINT "whatsmeow_app_state_mutation_macs_version_fk"
    FOREIGN KEY ("jid", "name")
    REFERENCES "whatsmeow_app_state_version" ("jid", "name")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsmeow_app_state_mutation_macs_index_check"
    CHECK (octet_length("index_mac") = 32),
  CONSTRAINT "whatsmeow_app_state_mutation_macs_value_check"
    CHECK (octet_length("value_mac") = 32)
);

CREATE TABLE "whatsmeow_contacts" (
  "our_jid" text NOT NULL,
  "their_jid" text NOT NULL,
  "first_name" text,
  "full_name" text,
  "push_name" text,
  "business_name" text,
  "redacted_phone" text,
  CONSTRAINT "whatsmeow_contacts_pk"
    PRIMARY KEY ("our_jid", "their_jid"),
  CONSTRAINT "whatsmeow_contacts_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "whatsmeow_chat_settings" (
  "our_jid" text NOT NULL,
  "chat_jid" text NOT NULL,
  "muted_until" bigint NOT NULL DEFAULT 0,
  "pinned" boolean NOT NULL DEFAULT false,
  "archived" boolean NOT NULL DEFAULT false,
  CONSTRAINT "whatsmeow_chat_settings_pk"
    PRIMARY KEY ("our_jid", "chat_jid"),
  CONSTRAINT "whatsmeow_chat_settings_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "whatsmeow_message_secrets" (
  "our_jid" text NOT NULL,
  "chat_jid" text NOT NULL,
  "sender_jid" text NOT NULL,
  "message_id" text NOT NULL,
  "key" bytea NOT NULL,
  CONSTRAINT "whatsmeow_message_secrets_pk"
    PRIMARY KEY ("our_jid", "chat_jid", "sender_jid", "message_id"),
  CONSTRAINT "whatsmeow_message_secrets_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- This table intentionally mirrors the native SQLStore schema without a
-- device FK. Import, logout and delete paths purge it explicitly by our_jid.
CREATE TABLE "whatsmeow_privacy_tokens" (
  "our_jid" text NOT NULL,
  "their_jid" text NOT NULL,
  "token" bytea NOT NULL,
  "timestamp" bigint NOT NULL,
  "sender_timestamp" bigint,
  CONSTRAINT "whatsmeow_privacy_tokens_pk"
    PRIMARY KEY ("our_jid", "their_jid")
);

CREATE INDEX "idx_whatsmeow_privacy_tokens_our_jid_timestamp"
  ON "whatsmeow_privacy_tokens" ("our_jid", "timestamp");

CREATE TABLE "whatsmeow_nct_salt" (
  "our_jid" text PRIMARY KEY NOT NULL,
  "salt" bytea NOT NULL,
  CONSTRAINT "whatsmeow_nct_salt_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- LID mappings are global SQLStore metadata and are not channel scoped.
CREATE TABLE "whatsmeow_lid_map" (
  "lid" text PRIMARY KEY NOT NULL,
  "pn" text NOT NULL
);

CREATE UNIQUE INDEX "whatsmeow_lid_map_pn_uidx"
  ON "whatsmeow_lid_map" ("pn");

CREATE TABLE "whatsmeow_event_buffer" (
  "our_jid" text NOT NULL,
  "ciphertext_hash" bytea NOT NULL,
  "plaintext" bytea,
  "server_timestamp" bigint NOT NULL,
  "insert_timestamp" bigint NOT NULL,
  CONSTRAINT "whatsmeow_event_buffer_pk"
    PRIMARY KEY ("our_jid", "ciphertext_hash"),
  CONSTRAINT "whatsmeow_event_buffer_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsmeow_event_buffer_ciphertext_hash_check"
    CHECK (octet_length("ciphertext_hash") = 32)
);

CREATE TABLE "whatsmeow_retry_buffer" (
  "our_jid" text NOT NULL,
  "chat_jid" text NOT NULL,
  "message_id" text NOT NULL,
  "format" text NOT NULL,
  "plaintext" bytea NOT NULL,
  "timestamp" bigint NOT NULL,
  CONSTRAINT "whatsmeow_retry_buffer_pk"
    PRIMARY KEY ("our_jid", "chat_jid", "message_id"),
  CONSTRAINT "whatsmeow_retry_buffer_device_fk"
    FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device" ("jid")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "whatsmeow_retry_buffer_timestamp_idx"
  ON "whatsmeow_retry_buffer" ("our_jid", "timestamp");

-- Canonical worker mutations. Both Node and Go call these functions so lock
-- order, capability hashing and stale-writer rejection cannot drift.
-- A renamed PostgreSQL warm container keeps its immutable warm Docker
-- metadata.  On process restart it must recover the durable channel binding
-- before any provider or consumer is constructed.  The plaintext capability
-- remains only in the container environment; this function returns an
-- assignment only when its digest, writer epoch and physical container all
-- match the activating/assigned warm lineage and worker_runtime fence.
CREATE OR REPLACE FUNCTION public.hydrate_whatsapp_warm_runtime(
  p_warm_pool_id uuid,
  p_capability text,
  p_container_id text
)
RETURNS TABLE (
  worker_id uuid,
  account_id uuid,
  worker_type_id uuid,
  runtime_generation integer,
  writer_epoch uuid,
  session_storage character varying
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_capability_hash text;
BEGIN
  IF p_warm_pool_id IS NULL
    OR p_capability IS NULL
    OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR p_container_id IS NULL
    OR trim(p_container_id) !~ '^[0-9a-f]{12,64}$'
  THEN
    RETURN;
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');

  RETURN QUERY
  SELECT
    owner."worker_id",
    owner."account_id",
    owner."worker_type_id",
    runtime."runtime_generation",
    runtime."session_writer_epoch",
    runtime."session_storage"
  FROM public."worker_warm_pool" AS pool
  INNER JOIN public."worker" AS owner
    ON owner."worker_id" = pool."reserved_by_worker_id"
  INNER JOIN public."worker_runtime" AS runtime
    ON runtime."worker_id" = owner."worker_id"
   AND runtime."warm_pool_id" = pool."warm_pool_id"
  WHERE pool."warm_pool_id" = p_warm_pool_id
    AND pool."state" IN ('activating', 'assigned')
    AND pool."session_storage" = 'postgres'
    AND pool."session_volume_name" IS NULL
    AND pool."runtime_capability_hash" = v_capability_hash
    AND pool."session_writer_epoch" IS NOT NULL
    AND (
      pool."container_id" = trim(p_container_id)
      OR pool."container_id" LIKE trim(p_container_id) || '%'
    )
    AND owner."deleted_at" IS NULL
    AND owner."worker_type_id" = pool."worker_type_id"
    AND runtime."session_storage" = 'postgres'
    AND runtime."session_volume_name" IS NULL
    AND runtime."runtime_generation" > 0
    AND runtime."runtime_generation" = pool."runtime_generation"
    AND runtime."runtime_capability_hash" = v_capability_hash
    AND runtime."session_writer_epoch" = pool."session_writer_epoch"
    AND (
      runtime."container_id" = trim(p_container_id)
      OR runtime."container_id" LIKE trim(p_container_id) || '%'
    )
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text,
  p_connection_epoch uuid
)
RETURNS TABLE (
  activated boolean,
  already_active boolean,
  connection_sequence bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_expected_worker_type uuid;
  v_capability_hash text;
  v_worker_storage character varying(20);
  v_runtime public.worker_runtime%ROWTYPE;
  v_header_provider character varying(20);
  v_header_generation integer;
  v_header_writer_epoch uuid;
  v_header_capability_hash character varying(64);
BEGIN
  activated := false;
  already_active := false;
  connection_sequence := NULL;

  IF p_worker_id IS NULL
    OR p_account_id IS NULL
    OR p_generation IS NULL
    OR p_generation <= 0
    OR p_writer_epoch IS NULL
    OR p_connection_epoch IS NULL
    OR p_capability IS NULL
    OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR p_container_id IS NULL
    OR trim(p_container_id) !~ '^[0-9a-f]{12,64}$'
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_expected_worker_type := CASE lower(trim(p_provider))
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
    ELSE NULL
  END;
  IF v_expected_worker_type IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');

  -- Global lock order is worker first, runtime second, warm lineage third
  -- (when present), and session header last.
  SELECT w."session_storage"
  INTO v_worker_storage
  FROM public."worker" AS w
  WHERE w."worker_id" = p_worker_id
    AND w."account_id" = p_account_id
    AND w."worker_type_id" = v_expected_worker_type
    AND w."deleted_at" IS NULL
    AND w."worker_status_id" NOT IN (
      '019a930d-c6f6-766d-9c84-437433031776'::uuid,
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
      '019a930d-c6f6-766d-9c84-4dc1777f8f69'::uuid,
      '019bcd18-ce66-77a2-9d7c-e48159c253da'::uuid
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT runtime.*
  INTO v_runtime
  FROM public."worker_runtime" AS runtime
  WHERE runtime."worker_id" = p_worker_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_runtime."container_id" IS NULL
    OR NOT (
      v_runtime."container_id" = trim(p_container_id)
      OR v_runtime."container_id" LIKE trim(p_container_id) || '%'
    )
    OR v_runtime."runtime_generation" <> p_generation
    OR v_runtime."runtime_capability_hash" IS NULL
    OR v_runtime."runtime_capability_hash" <> v_capability_hash
    OR v_runtime."session_storage" IS DISTINCT FROM v_worker_storage
    OR v_runtime."session_writer_epoch" IS DISTINCT FROM p_writer_epoch
    OR (
      v_runtime."source_provider" IS NOT NULL
      AND v_runtime."source_provider" <> lower(trim(p_provider))
    )
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_worker_storage = 'postgres' AND v_runtime."warm_pool_id" IS NOT NULL THEN
    PERFORM 1
    FROM public."worker_warm_pool" AS pool
    WHERE pool."warm_pool_id" = v_runtime."warm_pool_id"
      AND pool."state" IN ('activating', 'assigned')
      AND pool."reserved_by_worker_id" = p_worker_id
      AND pool."worker_type_id" = v_expected_worker_type
      AND pool."session_storage" = 'postgres'
      AND pool."session_volume_name" IS NULL
      AND pool."runtime_generation" = v_runtime."runtime_generation"
      AND pool."runtime_capability_hash" = v_runtime."runtime_capability_hash"
      AND pool."session_writer_epoch" = v_runtime."session_writer_epoch"
      AND pool."container_id" = v_runtime."container_id"
    FOR SHARE;
    IF NOT FOUND THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_worker_storage = 'postgres' THEN
    SELECT session."provider", session."writer_generation",
      session."writer_epoch", session."capability_hash"
    INTO v_header_provider, v_header_generation, v_header_writer_epoch,
      v_header_capability_hash
    FROM public."worker_whatsapp_session" AS session
    WHERE session."worker_id" = p_worker_id
    FOR UPDATE;

    IF FOUND AND (
      v_header_provider <> lower(trim(p_provider))
      OR v_header_generation > p_generation
      OR (
        v_header_generation = p_generation
        AND v_header_writer_epoch IS NOT NULL
        AND v_header_writer_epoch <> p_writer_epoch
      )
      OR (
        v_header_generation = p_generation
        AND v_header_capability_hash IS NOT NULL
        AND v_header_capability_hash <> v_capability_hash
      )
    ) THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  already_active := COALESCE(
    v_runtime."connection_epoch" = p_connection_epoch::text
      AND v_runtime."source_provider" = lower(trim(p_provider))
      AND v_runtime."session_writer_epoch" = p_writer_epoch
      AND v_runtime."connection_sequence" > 0,
    false
  );

  IF already_active THEN
    connection_sequence := v_runtime."connection_sequence";
  ELSE
    UPDATE public."worker_runtime" AS runtime
    SET "connection_epoch" = p_connection_epoch::text,
        "connection_sequence" = runtime."connection_sequence" + 1,
        "source_provider" = lower(trim(p_provider)),
        "connection_activated_at" = clock_timestamp(),
        "updated_at" = clock_timestamp()
    WHERE runtime."worker_id" = p_worker_id
      AND (
        runtime."container_id" = trim(p_container_id)
        OR runtime."container_id" LIKE trim(p_container_id) || '%'
      )
      AND runtime."runtime_generation" = p_generation
      AND runtime."runtime_capability_hash" = v_capability_hash
      AND runtime."session_storage" = v_worker_storage
      AND runtime."session_writer_epoch" = p_writer_epoch
    RETURNING runtime."connection_sequence" INTO connection_sequence;

    IF connection_sequence IS NULL THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF v_worker_storage = 'postgres' THEN
    INSERT INTO public."worker_whatsapp_session" (
      "worker_id", "provider", "state", "writer_generation",
      "writer_epoch", "capability_hash", "created_at", "updated_at"
    ) VALUES (
      p_worker_id, lower(trim(p_provider)), 'empty', p_generation,
      p_writer_epoch, v_capability_hash, clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT ("worker_id") DO UPDATE
    SET "writer_generation" = EXCLUDED."writer_generation",
        "writer_epoch" = EXCLUDED."writer_epoch",
        "capability_hash" = EXCLUDED."capability_hash",
        "updated_at" = clock_timestamp()
    WHERE public."worker_whatsapp_session"."provider" = EXCLUDED."provider"
      AND public."worker_whatsapp_session"."writer_generation"
        <= EXCLUDED."writer_generation"
    RETURNING "provider", "writer_generation", "writer_epoch", "capability_hash"
    INTO v_header_provider, v_header_generation, v_header_writer_epoch,
      v_header_capability_hash;

    IF NOT FOUND
      OR v_header_provider <> lower(trim(p_provider))
      OR v_header_generation <> p_generation
      OR v_header_writer_epoch IS DISTINCT FROM p_writer_epoch
      OR v_header_capability_hash IS DISTINCT FROM v_capability_hash
    THEN
      RAISE EXCEPTION 'whatsapp session header fence conflict'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  activated := true;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_worker_runtime_status(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text,
  p_status jsonb,
  p_event_id uuid
)
RETURNS TABLE (
  outcome text,
  event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_expected_worker_type uuid;
  v_capability_hash text;
  v_runtime public.worker_runtime%ROWTYPE;
  v_status_id uuid;
  v_status_text text;
  v_event_type text;
  v_mutates_status boolean;
  v_connection_epoch_text text;
  v_connection_sequence bigint;
  v_requires_connection_fence boolean;
  v_existing_worker_id uuid;
  v_phone text;
  v_current_worker_status_id uuid;
  v_lifecycle_operation_id uuid;
  v_disconnected_user boolean;
  v_strong_invalidation boolean;
  v_strong_degradation boolean;
  v_transient_connection_event boolean;
BEGIN
  outcome := 'invalid';
  event_id := p_event_id;

  IF p_worker_id IS NULL
    OR p_account_id IS NULL
    OR p_generation IS NULL
    OR p_generation <= 0
    OR p_writer_epoch IS NULL
    OR p_capability IS NULL
    OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR p_container_id IS NULL
    OR trim(p_container_id) !~ '^[0-9a-f]{12,64}$'
    OR p_event_id IS NULL
    OR p_status IS NULL
    OR jsonb_typeof(p_status) <> 'object'
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_expected_worker_type := CASE lower(trim(p_provider))
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
    ELSE NULL
  END;
  IF v_expected_worker_type IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_event_type := COALESCE(NULLIF(trim(p_status->>'event_type'), ''), 'status');
  IF length(v_event_type) > 50 OR v_event_type NOT IN ('status', 'telemetry') THEN
    RETURN NEXT;
    RETURN;
  END IF;
  v_mutates_status := v_event_type = 'status';

  v_status_text := NULLIF(trim(p_status->>'worker_status_id'), '');
  IF v_mutates_status AND v_status_text IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_status_text IS NOT NULL THEN
    IF v_status_text !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      RETURN NEXT;
      RETURN;
    END IF;
    v_status_id := v_status_text::uuid;
    IF v_status_id NOT IN (
      '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid,
      '019a930d-c6f6-766d-9c84-3696c2cd5ed8'::uuid,
      '019a930d-c6f6-766d-9c84-3904383fe742'::uuid,
      '019a930d-c6f6-766d-9c84-3f0abf55560d'::uuid,
      '019a930d-c6f6-766d-9c84-48cb970a9f21'::uuid,
      '019a930d-c6f6-766d-9c84-5056ccf66633'::uuid
    ) THEN
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;
  v_phone := NULLIF(trim(p_status->>'phone'), '');
  IF v_phone IS NOT NULL AND length(v_phone) > 20 THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_connection_epoch_text := NULLIF(trim(p_status->>'connection_epoch'), '');
  v_requires_connection_fence :=
    v_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    OR lower(COALESCE(p_status->>'requires_connection_fence', 'false')) = 'true';
  IF v_connection_epoch_text IS NOT NULL AND v_connection_epoch_text !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_requires_connection_fence AND v_connection_epoch_text IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_status ? 'connection_sequence' THEN
    IF COALESCE(p_status->>'connection_sequence', '') !~ '^[1-9][0-9]*$' THEN
      RETURN NEXT;
      RETURN;
    END IF;
    v_connection_sequence := (p_status->>'connection_sequence')::bigint;
  END IF;
  -- Connection identity is atomic. Sequence zero is represented by both
  -- fields being absent and is copied from the authoritative runtime row into
  -- the outbox. Once fenced, workers must always provide the epoch and its
  -- positive sequence together.
  IF (v_connection_epoch_text IS NULL) <> (v_connection_sequence IS NULL) THEN
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_requires_connection_fence AND v_connection_sequence IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    AND NOT (
      lower(COALESCE(p_status->>'session_ready', 'false')) = 'true'
      AND lower(COALESCE(p_status->>'can_send', 'false')) = 'true'
      AND lower(COALESCE(p_status->>'can_receive_runtime', 'false')) = 'true'
      AND lower(COALESCE(p_status->>'authenticated', 'false')) = 'true'
    )
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_disconnected_user :=
    lower(COALESCE(p_status->>'disconnected_user', 'false')) = 'true';
  v_strong_invalidation := v_disconnected_user OR
    COALESCE(p_status->>'code', '') IN ('205', '401', '403', '411', '440', '500', '600');
  v_transient_connection_event :=
    COALESCE(p_status->>'code', '') IN ('203', '408', '428', '503', '515');
  v_strong_degradation :=
    lower(COALESCE(p_status->>'session_ready', '')) = 'false'
    AND (
      lower(COALESCE(p_status->>'can_send', '')) = 'false'
      OR lower(COALESCE(p_status->>'can_receive_runtime', '')) = 'false'
    )
    AND lower(concat_ws(' ',
      p_status->>'status', p_status->>'provider_state',
      p_status->>'degraded_reason', p_status->>'reason', p_status->>'error'
    )) ~ '(connecting|disconnected|disconnecting|offline|closed|kafka_consumers_not_ready|kafka_not_ready|kafka_unhealthy|missing_client_info|event_bridge_not_attached|missing_local_session|store_wwebjs_not_ready|session_probe_failed|self_jid_not_registered|registration_probe_unavailable)';

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');

  SELECT w."worker_status_id", w."lifecycle_operation_id"
  INTO v_current_worker_status_id, v_lifecycle_operation_id
  FROM public."worker" AS w
  WHERE w."worker_id" = p_worker_id
    AND w."account_id" = p_account_id
    AND w."worker_type_id" = v_expected_worker_type
    AND w."deleted_at" IS NULL
    AND w."worker_status_id" NOT IN (
      '019a930d-c6f6-766d-9c84-437433031776'::uuid,
      '019a930d-c6f6-766d-9c84-4dc1777f8f69'::uuid,
      '019bcd18-ce66-77a2-9d7c-e48159c253da'::uuid
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'stale';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT runtime.*
  INTO v_runtime
  FROM public."worker_runtime" AS runtime
  WHERE runtime."worker_id" = p_worker_id
  FOR SHARE;
  IF NOT FOUND
    OR v_runtime."container_id" IS NULL
    OR NOT (
      v_runtime."container_id" = trim(p_container_id)
      OR v_runtime."container_id" LIKE trim(p_container_id) || '%'
    )
    OR v_runtime."runtime_generation" <> p_generation
    OR v_runtime."source_provider" IS DISTINCT FROM lower(trim(p_provider))
    OR v_runtime."runtime_capability_hash" IS DISTINCT FROM v_capability_hash
    OR v_runtime."session_writer_epoch" IS DISTINCT FROM p_writer_epoch
    OR (
      v_connection_epoch_text IS NOT NULL
      AND (
        v_runtime."connection_epoch" IS DISTINCT FROM v_connection_epoch_text
        OR v_runtime."connection_sequence" IS DISTINCT FROM v_connection_sequence
      )
    )
  THEN
    outcome := 'stale';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT outbox."worker_id"
  INTO v_existing_worker_id
  FROM public."worker_runtime_event_outbox" AS outbox
  WHERE outbox."event_id" = p_event_id;
  IF FOUND THEN
    outcome := CASE
      WHEN v_existing_worker_id = p_worker_id THEN 'duplicate'
      ELSE 'invalid'
    END;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_mutates_status AND v_lifecycle_operation_id IS NOT NULL THEN
    IF v_status_id <> '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid THEN
      outcome := 'deferred';
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_current_worker_status_id NOT IN (
      '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid,
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
      '019a930d-c6f6-766d-9c84-52e87789979b'::uuid
    ) THEN
      RETURN NEXT;
      RETURN;
    END IF;
  ELSIF v_mutates_status
    AND v_status_id <> '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    AND v_current_worker_status_id IN (
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
      '019a930d-c6f6-766d-9c84-52e87789979b'::uuid
    )
  THEN
    outcome := 'deferred';
    RETURN NEXT;
    RETURN;
  END IF;

  -- A pre-fence QR/connecting event is valid while the channel is available,
  -- but can never regress an already-online runtime. Once online, only the
  -- exact active connection epoch may report degradation or invalidation.
  IF v_current_worker_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
    AND (
      (NOT v_mutates_status AND v_connection_epoch_text IS NULL)
      OR (
        v_mutates_status
        AND v_status_id <> '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
        AND (
          v_connection_epoch_text IS NULL
          OR (
            NOT v_disconnected_user
            AND NOT v_strong_invalidation
            AND (v_transient_connection_event OR NOT v_strong_degradation)
          )
        )
      )
    )
  THEN
    outcome := 'deferred';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_mutates_status THEN
    UPDATE public."worker" AS w
    SET "worker_status_id" = v_status_id,
      "number" = CASE
        WHEN v_disconnected_user THEN NULL
        WHEN v_status_id <> '019a930d-c6f6-766d-9c84-3904383fe742'::uuid
          AND v_phone IS NOT NULL THEN v_phone
        ELSE w."number"
      END,
      "container_id" = CASE
        WHEN v_disconnected_user THEN NULL
        WHEN v_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
          THEN v_runtime."container_id"
        ELSE w."container_id"
      END,
      "last_connection_check_at" = CASE
        WHEN v_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
          THEN clock_timestamp()
        ELSE w."last_connection_check_at"
      END,
      "connection_date" = CASE
        WHEN v_disconnected_user THEN NULL
        WHEN v_status_id = '019a930d-c6f6-766d-9c84-30af6ecc33b2'::uuid
          THEN clock_timestamp()
        ELSE w."connection_date"
      END,
        "updated_at" = clock_timestamp()
    WHERE w."worker_id" = p_worker_id
      AND w."account_id" = p_account_id;
  END IF;

  INSERT INTO public."worker_runtime_event_outbox" (
    "event_id", "worker_id", "account_id", "provider", "container_id",
    "runtime_generation", "writer_epoch", "connection_sequence",
    "capability_hash", "event_type", "payload", "state", "available_at",
    "created_at"
  ) VALUES (
    p_event_id, p_worker_id, p_account_id, lower(trim(p_provider)),
    v_runtime."container_id", p_generation, p_writer_epoch,
    v_runtime."connection_sequence", v_capability_hash, v_event_type,
    p_status, 'pending', clock_timestamp(), clock_timestamp()
  );

  outcome := 'applied';
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_worker_self_heal(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text,
  p_reason text,
  p_evidence jsonb,
  p_request_key text
)
RETURNS TABLE (
  request_id uuid,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_expected_worker_type uuid;
  v_capability_hash text;
  v_runtime public.worker_runtime%ROWTYPE;
  v_existing_request_id uuid;
  v_existing_worker_id uuid;
BEGIN
  request_id := NULL;
  created := false;

  IF p_worker_id IS NULL
    OR p_account_id IS NULL
    OR p_generation IS NULL
    OR p_generation <= 0
    OR p_writer_epoch IS NULL
    OR p_capability IS NULL
    OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR p_container_id IS NULL
    OR trim(p_container_id) !~ '^[0-9a-f]{12,64}$'
    OR p_reason IS NULL
    OR length(trim(p_reason)) = 0
    OR length(p_reason) > 100
    OR p_request_key IS NULL
    OR length(trim(p_request_key)) = 0
    OR length(p_request_key) > 255
    OR p_evidence IS NULL
    OR jsonb_typeof(p_evidence) <> 'object'
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_expected_worker_type := CASE lower(trim(p_provider))
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
    ELSE NULL
  END;
  IF v_expected_worker_type IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');

  PERFORM 1
  FROM public."worker" AS w
  WHERE w."worker_id" = p_worker_id
    AND w."account_id" = p_account_id
    AND w."worker_type_id" = v_expected_worker_type
    AND w."deleted_at" IS NULL
    AND w."worker_status_id" NOT IN (
      '019a930d-c6f6-766d-9c84-437433031776'::uuid,
      '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid,
      '019a930d-c6f6-766d-9c84-4dc1777f8f69'::uuid,
      '019bcd18-ce66-77a2-9d7c-e48159c253da'::uuid
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Requests are rare; the exclusive runtime lock makes active dedup exact.
  SELECT runtime.*
  INTO v_runtime
  FROM public."worker_runtime" AS runtime
  WHERE runtime."worker_id" = p_worker_id
  FOR UPDATE;
  IF NOT FOUND
    OR NOT (
      v_runtime."container_id" = trim(p_container_id)
      OR v_runtime."container_id" LIKE trim(p_container_id) || '%'
    )
    OR v_runtime."runtime_generation" <> p_generation
    OR v_runtime."source_provider" <> lower(trim(p_provider))
    OR v_runtime."runtime_capability_hash" <> v_capability_hash
    OR v_runtime."session_writer_epoch" <> p_writer_epoch
    OR v_runtime."connection_sequence" <= 0
  THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT request."request_id", request."worker_id"
  INTO v_existing_request_id, v_existing_worker_id
  FROM public."worker_self_heal_request" AS request
  WHERE request."request_key" = trim(p_request_key)
    AND request."state" IN ('queued', 'processing', 'dispatched')
  ORDER BY request."created_at" DESC
  LIMIT 1;
  IF FOUND THEN
    IF v_existing_worker_id = p_worker_id THEN
      request_id := v_existing_request_id;
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT request."request_id"
  INTO v_existing_request_id
  FROM public."worker_self_heal_request" AS request
  WHERE request."worker_id" = p_worker_id
    AND request."runtime_generation" = p_generation
    AND request."capability_hash" = v_capability_hash
    AND request."reason" = trim(p_reason)
    AND request."state" IN ('queued', 'processing', 'dispatched')
  ORDER BY request."created_at" DESC
  LIMIT 1;
  IF FOUND THEN
    request_id := v_existing_request_id;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public."worker_self_heal_request" (
    "request_id", "request_key", "worker_id", "account_id", "provider",
    "container_id", "runtime_generation", "writer_epoch", "capability_hash",
    "reason", "evidence", "state", "available_at", "created_at", "updated_at"
  ) VALUES (
    gen_random_uuid(), trim(p_request_key), p_worker_id, p_account_id,
    lower(trim(p_provider)), v_runtime."container_id", p_generation,
    p_writer_epoch, v_capability_hash, trim(p_reason), p_evidence, 'queued',
    clock_timestamp(), clock_timestamp(), clock_timestamp()
  )
  RETURNING "worker_self_heal_request"."request_id" INTO request_id;

  created := true;
  RETURN NEXT;
END;
$function$;
