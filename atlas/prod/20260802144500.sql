-- atlas:txmode file

-- Destructive development migration: replace every provider-specific WhatsApp

-- store with the session/revision-scoped canonical schema.

-- Create "whatsapp_store_version" table
CREATE TABLE "public"."whatsapp_store_version" (
  "version" integer NOT NULL,
  "compat" integer NOT NULL,
  CONSTRAINT "whatsapp_store_version_pk" PRIMARY KEY ("version"),
  CONSTRAINT "whatsapp_store_version_single_supported_check" CHECK ((version = 16) AND (compat = 16))
);
-- Create "whatsapp_session_revision" table
CREATE TABLE "public"."whatsapp_session_revision" (
  "session_id" uuid NOT NULL,
  "revision_id" bigserial NOT NULL,
  "provider" character varying(20) NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'staging',
  "source" character varying(30) NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "codec_version" integer NOT NULL DEFAULT 1,
  "format" character varying(80) NOT NULL,
  "checksum_sha256" character varying(64) NULL,
  "size_bytes" bigint NOT NULL DEFAULT 0,
  "writer_generation" integer NOT NULL,
  "writer_epoch" uuid NOT NULL,
  "capability_hash" character varying(64) NOT NULL,
  "error_code" character varying(100) NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "persisted_at" timestamptz NULL,
  "validated_at" timestamptz NULL,
  "promoted_at" timestamptz NULL,
  "retired_at" timestamptz NULL,
  CONSTRAINT "whatsapp_session_revision_pk" PRIMARY KEY ("session_id", "revision_id"),
  CONSTRAINT "whatsapp_session_revision_capability_check" CHECK ((capability_hash)::text ~ '^[0-9a-f]{64}$'::text),
  CONSTRAINT "whatsapp_session_revision_checksum_check" CHECK ((checksum_sha256 IS NULL) OR ((checksum_sha256)::text ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "whatsapp_session_revision_generation_check" CHECK (writer_generation > 0),
  CONSTRAINT "whatsapp_session_revision_provider_check" CHECK ((provider)::text = ANY ((ARRAY['baileys'::character varying, 'wwebjs'::character varying, 'whatsmeow'::character varying])::text[])),
  CONSTRAINT "whatsapp_session_revision_size_check" CHECK (size_bytes >= 0),
  CONSTRAINT "whatsapp_session_revision_source_check" CHECK ((source)::text = ANY ((ARRAY['pairing'::character varying, 'checkpoint'::character varying, 'secure_import'::character varying, 'handoff'::character varying, 'rollback'::character varying])::text[])),
  CONSTRAINT "whatsapp_session_revision_status_check" CHECK ((status)::text = ANY ((ARRAY['staging'::character varying, 'validating'::character varying, 'active'::character varying, 'retired'::character varying, 'failed'::character varying])::text[])),
  CONSTRAINT "whatsapp_session_revision_version_check" CHECK ((schema_version > 0) AND (codec_version > 0))
) WITH (fillfactor = 100);
-- Create index "whatsapp_session_revision_gc_idx" to table: "whatsapp_session_revision"
CREATE INDEX "whatsapp_session_revision_gc_idx" ON "public"."whatsapp_session_revision" ("created_at", "session_id", "revision_id") WHERE ((status)::text = ANY ((ARRAY['staging'::character varying, 'failed'::character varying, 'retired'::character varying])::text[]));
-- Create index "whatsapp_session_revision_active_uidx" to table: "whatsapp_session_revision"
CREATE UNIQUE INDEX "whatsapp_session_revision_active_uidx" ON "public"."whatsapp_session_revision" ("session_id") WHERE ((status)::text = 'active'::text);
-- Create "whatsapp_device" table
CREATE TABLE "public"."whatsapp_device" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "jid" text NULL,
  "lid" text NULL,
  "facebook_uuid" uuid NULL,
  "registration_id" bigint NULL,
  "noise_key" bytea NULL,
  "identity_key" bytea NULL,
  "signed_pre_key" bytea NULL,
  "signed_pre_key_id" integer NULL,
  "signed_pre_key_sig" bytea NULL,
  "adv_key" bytea NULL,
  "adv_details" bytea NULL,
  "adv_account_sig" bytea NULL,
  "adv_account_sig_key" bytea NULL,
  "adv_device_sig" bytea NULL,
  "platform" text NOT NULL DEFAULT '',
  "business_name" text NOT NULL DEFAULT '',
  "push_name" text NOT NULL DEFAULT '',
  "lid_migration_ts" bigint NOT NULL DEFAULT 0,
  "next_pre_key_id" integer NOT NULL DEFAULT 1,
  "device_fingerprint" bytea NULL,
  CONSTRAINT "whatsapp_device_pk" PRIMARY KEY ("session_id", "revision_id"),
  CONSTRAINT "whatsapp_device_revision_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_device_adv_account_sig_check" CHECK ((adv_account_sig IS NULL) OR (octet_length(adv_account_sig) = 64)),
  CONSTRAINT "whatsapp_device_adv_account_sig_key_check" CHECK ((adv_account_sig_key IS NULL) OR (octet_length(adv_account_sig_key) = 32)),
  CONSTRAINT "whatsapp_device_adv_device_sig_check" CHECK ((adv_device_sig IS NULL) OR (octet_length(adv_device_sig) = 64)),
  CONSTRAINT "whatsapp_device_fingerprint_check" CHECK ((device_fingerprint IS NULL) OR (octet_length(device_fingerprint) = 32)),
  CONSTRAINT "whatsapp_device_identity_key_check" CHECK ((identity_key IS NULL) OR (octet_length(identity_key) = 32)),
  CONSTRAINT "whatsapp_device_native_credentials_complete_check" CHECK ((num_nonnulls(registration_id, noise_key, identity_key, signed_pre_key, signed_pre_key_id, signed_pre_key_sig, adv_key, adv_details, adv_account_sig, adv_account_sig_key, adv_device_sig) = 0) OR (num_nulls(registration_id, noise_key, identity_key, signed_pre_key, signed_pre_key_id, signed_pre_key_sig, adv_key, adv_details, adv_account_sig, adv_account_sig_key, adv_device_sig) = 0)),
  CONSTRAINT "whatsapp_device_noise_key_check" CHECK ((noise_key IS NULL) OR (octet_length(noise_key) = 32)),
  CONSTRAINT "whatsapp_device_pre_key_counter_check" CHECK ((next_pre_key_id > 0) AND (next_pre_key_id <= 16777216)),
  CONSTRAINT "whatsapp_device_registration_id_check" CHECK ((registration_id IS NULL) OR ((registration_id >= 0) AND (registration_id < '4294967296'::bigint))),
  CONSTRAINT "whatsapp_device_signed_pre_key_check" CHECK ((signed_pre_key IS NULL) OR (octet_length(signed_pre_key) = 32)),
  CONSTRAINT "whatsapp_device_signed_pre_key_id_check" CHECK ((signed_pre_key_id IS NULL) OR ((signed_pre_key_id >= 0) AND (signed_pre_key_id < 16777216))),
  CONSTRAINT "whatsapp_device_signed_pre_key_sig_check" CHECK ((signed_pre_key_sig IS NULL) OR (octet_length(signed_pre_key_sig) = 64))
) WITH (fillfactor = 80);
-- Create index "whatsapp_device_jid_session_idx" to table: "whatsapp_device"
CREATE INDEX "whatsapp_device_jid_session_idx" ON "public"."whatsapp_device" ("jid", "session_id") WHERE (jid IS NOT NULL);
-- Create "whatsapp_app_state_version" table
CREATE TABLE "public"."whatsapp_app_state_version" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "name" text NOT NULL,
  "version" bigint NOT NULL,
  "hash" bytea NOT NULL,
  CONSTRAINT "whatsapp_app_state_version_pk" PRIMARY KEY ("session_id", "revision_id", "name"),
  CONSTRAINT "whatsapp_app_state_version_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_app_state_version_hash_check" CHECK (octet_length(hash) = 128)
) WITH (fillfactor = 80);
-- Create "whatsapp_app_state_mutation_macs" table
CREATE TABLE "public"."whatsapp_app_state_mutation_macs" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "name" text NOT NULL,
  "index_mac" bytea NOT NULL,
  "version" bigint NOT NULL,
  "value_mac" bytea NOT NULL,
  CONSTRAINT "whatsapp_app_state_mutation_macs_pk" PRIMARY KEY ("session_id", "revision_id", "name", "index_mac", "version"),
  CONSTRAINT "whatsapp_app_state_mutation_macs_version_fk" FOREIGN KEY ("session_id", "revision_id", "name") REFERENCES "public"."whatsapp_app_state_version" ("session_id", "revision_id", "name") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_app_state_mutation_macs_index_check" CHECK (octet_length(index_mac) = 32),
  CONSTRAINT "whatsapp_app_state_mutation_macs_value_check" CHECK (octet_length(value_mac) = 32)
) WITH (fillfactor = 80);
-- Create "whatsapp_app_state_sync_keys" table
CREATE TABLE "public"."whatsapp_app_state_sync_keys" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "key_id" bytea NOT NULL,
  "key_data" bytea NOT NULL,
  "timestamp" bigint NOT NULL,
  "fingerprint" bytea NOT NULL,
  CONSTRAINT "whatsapp_app_state_sync_keys_pk" PRIMARY KEY ("session_id", "revision_id", "key_id"),
  CONSTRAINT "whatsapp_app_state_sync_keys_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create index "whatsapp_app_state_sync_keys_latest_idx" to table: "whatsapp_app_state_sync_keys"
CREATE INDEX "whatsapp_app_state_sync_keys_latest_idx" ON "public"."whatsapp_app_state_sync_keys" ("session_id", "revision_id", "timestamp" DESC) INCLUDE ("key_id");
-- Create "whatsapp_artifact" table
CREATE TABLE "public"."whatsapp_artifact" (
  "session_id" uuid NOT NULL,
  "artifact_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "revision_id" bigint NOT NULL,
  "provider" character varying(20) NOT NULL,
  "kind" character varying(50) NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'staging',
  "manifest" jsonb NOT NULL DEFAULT '{}',
  "checksum_sha256" character varying(64) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "chunk_count" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "persisted_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_artifact_pk" PRIMARY KEY ("session_id", "artifact_id"),
  CONSTRAINT "whatsapp_artifact_revision_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_artifact_checksum_check" CHECK ((checksum_sha256)::text ~ '^[0-9a-f]{64}$'::text),
  CONSTRAINT "whatsapp_artifact_chunk_count_check" CHECK ((chunk_count >= 0) AND (chunk_count <= 65536)),
  CONSTRAINT "whatsapp_artifact_manifest_check" CHECK (jsonb_typeof(manifest) = 'object'::text),
  CONSTRAINT "whatsapp_artifact_provider_check" CHECK ((provider)::text = ANY ((ARRAY['baileys'::character varying, 'wwebjs'::character varying, 'whatsmeow'::character varying])::text[])),
  CONSTRAINT "whatsapp_artifact_size_check" CHECK ((size_bytes >= 0) AND (size_bytes <= 536870912)),
  CONSTRAINT "whatsapp_artifact_status_check" CHECK ((status)::text = ANY ((ARRAY['staging'::character varying, 'ready'::character varying, 'failed'::character varying, 'retired'::character varying])::text[]))
) WITH (fillfactor = 100);
-- Create index "whatsapp_artifact_revision_idx" to table: "whatsapp_artifact"
CREATE INDEX "whatsapp_artifact_revision_idx" ON "public"."whatsapp_artifact" ("session_id", "revision_id", "created_at");
-- Create "whatsapp_session" table
CREATE TABLE "public"."whatsapp_session" (
  "session_id" uuid NOT NULL,
  "provider" character varying(20) NOT NULL,
  "state" character varying(20) NOT NULL DEFAULT 'empty',
  "active_revision_id" bigint NULL,
  "previous_revision_id" bigint NULL,
  "generation" integer NOT NULL DEFAULT 1,
  "epoch" uuid NULL,
  "capability_hash" character varying(64) NULL,
  "active_device_fingerprint" bytea NULL,
  "last_persisted_at" timestamptz NULL,
  "last_error_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("session_id"),
  CONSTRAINT "whatsapp_session_active_revision_fk" FOREIGN KEY ("session_id", "active_revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "whatsapp_session_previous_revision_fk" FOREIGN KEY ("session_id", "previous_revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "whatsapp_session_worker_fk" FOREIGN KEY ("session_id") REFERENCES "public"."worker" ("worker_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_session_capability_check" CHECK ((capability_hash IS NULL) OR ((capability_hash)::text ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "whatsapp_session_fingerprint_check" CHECK ((active_device_fingerprint IS NULL) OR (octet_length(active_device_fingerprint) = 32)),
  CONSTRAINT "whatsapp_session_generation_check" CHECK (generation > 0),
  CONSTRAINT "whatsapp_session_provider_check" CHECK ((provider)::text = ANY ((ARRAY['baileys'::character varying, 'wwebjs'::character varying, 'whatsmeow'::character varying])::text[])),
  CONSTRAINT "whatsapp_session_revision_distinct_check" CHECK ((active_revision_id IS NULL) OR (previous_revision_id IS NULL) OR (active_revision_id <> previous_revision_id)),
  CONSTRAINT "whatsapp_session_state_check" CHECK ((state)::text = ANY ((ARRAY['empty'::character varying, 'preparing'::character varying, 'ready'::character varying, 'handoff'::character varying, 'error'::character varying])::text[]))
) WITH (fillfactor = 80);
-- Every revision belongs to an existing WhatsApp session. The constraint is
-- added after both sides exist because whatsapp_session also points at its
-- active and previous revisions.
ALTER TABLE "public"."whatsapp_session_revision"
  ADD CONSTRAINT "whatsapp_session_revision_session_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_session" ("session_id")
  ON UPDATE NO ACTION ON DELETE CASCADE;
-- Create index "whatsapp_session_active_device_fingerprint_uidx" to table: "whatsapp_session"
CREATE UNIQUE INDEX "whatsapp_session_active_device_fingerprint_uidx" ON "public"."whatsapp_session" ("active_device_fingerprint") WHERE (active_device_fingerprint IS NOT NULL);
-- Create "whatsapp_session_gc_queue" table
CREATE TABLE "public"."whatsapp_session_gc_queue" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "revision_status" character varying(20) NOT NULL,
  "eligible_at" timestamptz NOT NULL,
  "claim_token" uuid NULL,
  "claim_expires_at" timestamptz NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_error_code" character varying(100) NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_session_gc_queue_pk" PRIMARY KEY ("session_id", "revision_id"),
  CONSTRAINT "whatsapp_session_gc_queue_revision_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_session_gc_queue_status_check" CHECK ((revision_status)::text = ANY ((ARRAY['staging'::character varying, 'failed'::character varying, 'retired'::character varying])::text[])),
  CONSTRAINT "whatsapp_session_gc_queue_attempt_check" CHECK (attempt_count >= 0),
  CONSTRAINT "whatsapp_session_gc_queue_claim_check" CHECK (((claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((claim_token IS NOT NULL) AND (claim_expires_at IS NOT NULL)))
) WITH (fillfactor = 80);
-- Create index "whatsapp_session_gc_queue_dispatch_idx" to table: "whatsapp_session_gc_queue"
CREATE INDEX "whatsapp_session_gc_queue_dispatch_idx" ON "public"."whatsapp_session_gc_queue" ("eligible_at", "session_id", "revision_id") WHERE (claim_token IS NULL);
-- Create index "whatsapp_session_gc_queue_claim_expiry_idx" to table: "whatsapp_session_gc_queue"
CREATE INDEX "whatsapp_session_gc_queue_claim_expiry_idx" ON "public"."whatsapp_session_gc_queue" ("claim_expires_at", "session_id", "revision_id") WHERE (claim_token IS NOT NULL);
-- Create "whatsapp_artifact_blob" table
CREATE TABLE "public"."whatsapp_artifact_blob" (
  "session_id" uuid NOT NULL,
  "sha256" character varying(64) NOT NULL,
  "payload" bytea NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_artifact_blob_pk" PRIMARY KEY ("session_id", "sha256"),
  CONSTRAINT "whatsapp_artifact_blob_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_session" ("session_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_artifact_blob_checksum_check" CHECK ((sha256)::text ~ '^[0-9a-f]{64}$'::text),
  CONSTRAINT "whatsapp_artifact_blob_digest_check" CHECK ((sha256)::text = encode(public.digest(payload, 'sha256'::text), 'hex'::text)),
  CONSTRAINT "whatsapp_artifact_blob_payload_check" CHECK ((size_bytes = octet_length(payload)) AND (size_bytes > 0) AND (size_bytes <= 1048576))
) WITH (fillfactor = 100);
-- Create "whatsapp_artifact_chunk" table
CREATE TABLE "public"."whatsapp_artifact_chunk" (
  "session_id" uuid NOT NULL,
  "artifact_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "sha256" character varying(64) NOT NULL,
  CONSTRAINT "whatsapp_artifact_chunk_pk" PRIMARY KEY ("session_id", "artifact_id", "chunk_index"),
  CONSTRAINT "whatsapp_artifact_chunk_artifact_fk" FOREIGN KEY ("session_id", "artifact_id") REFERENCES "public"."whatsapp_artifact" ("session_id", "artifact_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_artifact_chunk_blob_fk" FOREIGN KEY ("session_id", "sha256") REFERENCES "public"."whatsapp_artifact_blob" ("session_id", "sha256") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "whatsapp_artifact_chunk_index_check" CHECK (chunk_index >= 0)
);
-- Create index "whatsapp_artifact_chunk_blob_idx" to table: "whatsapp_artifact_chunk"
CREATE INDEX "whatsapp_artifact_chunk_blob_idx" ON "public"."whatsapp_artifact_chunk" ("session_id", "sha256");
-- Create "whatsapp_chat_settings" table
CREATE TABLE "public"."whatsapp_chat_settings" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "chat_jid" text NOT NULL,
  "muted_until" bigint NOT NULL DEFAULT 0,
  "pinned" boolean NOT NULL DEFAULT false,
  "archived" boolean NOT NULL DEFAULT false,
  CONSTRAINT "whatsapp_chat_settings_pk" PRIMARY KEY ("session_id", "revision_id", "chat_jid"),
  CONSTRAINT "whatsapp_chat_settings_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create "whatsapp_contacts" table
CREATE TABLE "public"."whatsapp_contacts" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "their_jid" text NOT NULL,
  "first_name" text NULL,
  "full_name" text NULL,
  "push_name" text NULL,
  "business_name" text NULL,
  "redacted_phone" text NULL,
  CONSTRAINT "whatsapp_contacts_pk" PRIMARY KEY ("session_id", "revision_id", "their_jid"),
  CONSTRAINT "whatsapp_contacts_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create "whatsapp_event_buffer" table
CREATE TABLE "public"."whatsapp_event_buffer" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "ciphertext_hash" bytea NOT NULL,
  "plaintext" bytea NULL,
  "server_timestamp" bigint NOT NULL,
  "insert_timestamp" bigint NOT NULL,
  CONSTRAINT "whatsapp_event_buffer_pk" PRIMARY KEY ("session_id", "revision_id", "ciphertext_hash"),
  CONSTRAINT "whatsapp_event_buffer_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_event_buffer_ciphertext_hash_check" CHECK (octet_length(ciphertext_hash) = 32)
) WITH (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
-- Create index "whatsapp_event_buffer_expiry_idx" to table: "whatsapp_event_buffer"
CREATE INDEX "whatsapp_event_buffer_expiry_idx" ON "public"."whatsapp_event_buffer" ("session_id", "revision_id", "insert_timestamp");
-- Create "whatsapp_identity_keys" table
CREATE TABLE "public"."whatsapp_identity_keys" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "their_id" text NOT NULL,
  "identity" bytea NOT NULL,
  CONSTRAINT "whatsapp_identity_keys_pk" PRIMARY KEY ("session_id", "revision_id", "their_id"),
  CONSTRAINT "whatsapp_identity_keys_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_identity_keys_identity_check" CHECK (octet_length(identity) = 32)
) WITH (fillfactor = 80);
-- Create "whatsapp_lid_map" table
CREATE TABLE "public"."whatsapp_lid_map" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "lid" text NOT NULL,
  "pn" text NOT NULL,
  CONSTRAINT "whatsapp_lid_map_pk" PRIMARY KEY ("session_id", "revision_id", "lid"),
  CONSTRAINT "whatsapp_lid_map_pn_unique" UNIQUE ("session_id", "revision_id", "pn"),
  CONSTRAINT "whatsapp_lid_map_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create "whatsapp_message_secrets" table
CREATE TABLE "public"."whatsapp_message_secrets" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "chat_jid" text NOT NULL,
  "sender_jid" text NOT NULL,
  "message_id" text NOT NULL,
  "key" bytea NOT NULL,
  CONSTRAINT "whatsapp_message_secrets_pk" PRIMARY KEY ("session_id", "revision_id", "chat_jid", "sender_jid", "message_id"),
  CONSTRAINT "whatsapp_message_secrets_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create "whatsapp_nct_salt" table
CREATE TABLE "public"."whatsapp_nct_salt" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "salt" bytea NOT NULL,
  CONSTRAINT "whatsapp_nct_salt_pk" PRIMARY KEY ("session_id", "revision_id"),
  CONSTRAINT "whatsapp_nct_salt_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create "whatsapp_pre_keys" table
CREATE TABLE "public"."whatsapp_pre_keys" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "key_id" integer NOT NULL,
  "key" bytea NOT NULL,
  "uploaded" boolean NOT NULL DEFAULT false,
  CONSTRAINT "whatsapp_pre_keys_pk" PRIMARY KEY ("session_id", "revision_id", "key_id"),
  CONSTRAINT "whatsapp_pre_keys_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_pre_keys_key_check" CHECK (octet_length(key) = 32),
  CONSTRAINT "whatsapp_pre_keys_key_id_check" CHECK ((key_id >= 0) AND (key_id < 16777216))
) WITH (fillfactor = 80);
-- Create index "whatsapp_pre_keys_pending_idx" to table: "whatsapp_pre_keys"
CREATE INDEX "whatsapp_pre_keys_pending_idx" ON "public"."whatsapp_pre_keys" ("session_id", "revision_id", "key_id") WHERE (uploaded = false);
-- Create "whatsapp_privacy_tokens" table
CREATE TABLE "public"."whatsapp_privacy_tokens" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "their_jid" text NOT NULL,
  "token" bytea NOT NULL,
  "timestamp" bigint NOT NULL,
  "sender_timestamp" bigint NULL,
  CONSTRAINT "whatsapp_privacy_tokens_pk" PRIMARY KEY ("session_id", "revision_id", "their_jid"),
  CONSTRAINT "whatsapp_privacy_tokens_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create index "whatsapp_privacy_tokens_expiry_idx" to table: "whatsapp_privacy_tokens"
CREATE INDEX "whatsapp_privacy_tokens_expiry_idx" ON "public"."whatsapp_privacy_tokens" ("session_id", "revision_id", "timestamp");
-- Create "whatsapp_provider_record" table
CREATE TABLE "public"."whatsapp_provider_record" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "namespace" character varying(100) NOT NULL,
  "record_key" character varying(500) NOT NULL,
  "codec_version" integer NOT NULL DEFAULT 1,
  "payload" bytea NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_provider_record_pk" PRIMARY KEY ("session_id", "revision_id", "namespace", "record_key"),
  CONSTRAINT "whatsapp_provider_record_revision_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_provider_record_codec_check" CHECK ((codec_version > 0) AND (octet_length(payload) > 0))
) WITH (fillfactor = 80);
-- Create "whatsapp_retry_buffer" table
CREATE TABLE "public"."whatsapp_retry_buffer" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "chat_jid" text NOT NULL,
  "message_id" text NOT NULL,
  "format" text NOT NULL,
  "plaintext" bytea NOT NULL,
  "timestamp" bigint NOT NULL,
  CONSTRAINT "whatsapp_retry_buffer_pk" PRIMARY KEY ("session_id", "revision_id", "chat_jid", "message_id"),
  CONSTRAINT "whatsapp_retry_buffer_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create index "whatsapp_retry_buffer_expiry_idx" to table: "whatsapp_retry_buffer"
CREATE INDEX "whatsapp_retry_buffer_expiry_idx" ON "public"."whatsapp_retry_buffer" ("session_id", "revision_id", "timestamp");
-- Create "whatsapp_sender_keys" table
CREATE TABLE "public"."whatsapp_sender_keys" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "chat_id" text NOT NULL,
  "sender_id" text NOT NULL,
  "sender_key" bytea NOT NULL,
  CONSTRAINT "whatsapp_sender_keys_pk" PRIMARY KEY ("session_id", "revision_id", "chat_id", "sender_id"),
  CONSTRAINT "whatsapp_sender_keys_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Create "whatsapp_session_handoff" table
CREATE TABLE "public"."whatsapp_session_handoff" (
  "session_id" uuid NOT NULL,
  "handoff_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "source_provider" character varying(20) NOT NULL,
  "target_provider" character varying(20) NOT NULL,
  "source_revision_id" bigint NOT NULL,
  "target_revision_id" bigint NULL,
  "state" character varying(20) NOT NULL DEFAULT 'requested',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "error_code" character varying(100) NULL,
  "source_checkpoint_checksum_sha256" character varying(64) NULL,
  "source_checkpoint_size_bytes" bigint NULL,
  "source_checkpoint_record_count" bigint NULL,
  "source_drained_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz NULL,
  "lifecycle_operation_id" uuid NULL,
  "recovery_state" character varying(20) NOT NULL DEFAULT 'none',
  "recovery_operation_id" uuid NULL,
  "recovery_cleanup_required" boolean NULL,
  "recovery_from_generation" integer NULL,
  "recovery_attempt_count" integer NOT NULL DEFAULT 0,
  "recovery_next_attempt_at" timestamptz NULL,
  "recovery_claim_token" uuid NULL,
  "recovery_claim_expires_at" timestamptz NULL,
  "recovery_last_error_code" character varying(100) NULL,
  "recovery_started_at" timestamptz NULL,
  "recovery_completed_at" timestamptz NULL,
  CONSTRAINT "whatsapp_session_handoff_pk" PRIMARY KEY ("session_id", "handoff_id"),
  CONSTRAINT "whatsapp_session_handoff_source_revision_fk" FOREIGN KEY ("session_id", "source_revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_session_handoff_target_revision_fk" FOREIGN KEY ("session_id", "target_revision_id") REFERENCES "public"."whatsapp_session_revision" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_session_handoff_attempt_check" CHECK (attempt_count >= 0),
  CONSTRAINT "whatsapp_session_handoff_checkpoint_checksum_check" CHECK (source_checkpoint_checksum_sha256 IS NULL OR (source_checkpoint_checksum_sha256)::text ~ '^[0-9a-f]{64}$'::text),
  CONSTRAINT "whatsapp_session_handoff_checkpoint_size_check" CHECK (source_checkpoint_size_bytes IS NULL OR source_checkpoint_size_bytes >= 0),
  CONSTRAINT "whatsapp_session_handoff_checkpoint_record_count_check" CHECK (source_checkpoint_record_count IS NULL OR source_checkpoint_record_count >= 0),
  CONSTRAINT "whatsapp_session_handoff_source_drain_proof_check" CHECK ((source_drained_at IS NULL AND source_checkpoint_checksum_sha256 IS NULL AND source_checkpoint_size_bytes IS NULL AND source_checkpoint_record_count IS NULL) OR (source_drained_at IS NOT NULL AND source_checkpoint_checksum_sha256 IS NOT NULL AND source_checkpoint_size_bytes IS NOT NULL AND source_checkpoint_record_count IS NOT NULL)),
  CONSTRAINT "whatsapp_session_handoff_recovery_attempt_check" CHECK (recovery_attempt_count >= 0),
  CONSTRAINT "whatsapp_session_handoff_recovery_generation_check" CHECK (recovery_from_generation IS NULL OR recovery_from_generation > 0),
  CONSTRAINT "whatsapp_session_handoff_recovery_state_check" CHECK ((recovery_state)::text = ANY ((ARRAY['none'::character varying, 'pending'::character varying, 'dispatching'::character varying, 'running'::character varying, 'completed'::character varying, 'blocked'::character varying, 'cancelled'::character varying])::text[])),
  CONSTRAINT "whatsapp_session_handoff_recovery_identity_check" CHECK (
    (recovery_state = 'none' AND recovery_operation_id IS NULL)
    OR (
      recovery_state <> 'none'
      AND recovery_operation_id IS NOT NULL
      AND recovery_next_attempt_at IS NOT NULL
    )
  ),
  CONSTRAINT "whatsapp_session_handoff_recovery_claim_check" CHECK (
    (recovery_claim_token IS NULL AND recovery_claim_expires_at IS NULL)
    OR (recovery_claim_token IS NOT NULL AND recovery_claim_expires_at IS NOT NULL)
  ),
  CONSTRAINT "whatsapp_session_handoff_recovery_completion_check" CHECK (
    (recovery_state = 'completed' AND recovery_completed_at IS NOT NULL)
    OR (recovery_state <> 'completed' AND recovery_completed_at IS NULL)
  ),
  CONSTRAINT "whatsapp_session_handoff_provider_check" CHECK (((source_provider)::text = ANY ((ARRAY['baileys'::character varying, 'wwebjs'::character varying, 'whatsmeow'::character varying])::text[])) AND ((target_provider)::text = ANY ((ARRAY['baileys'::character varying, 'wwebjs'::character varying, 'whatsmeow'::character varying])::text[]))),
  CONSTRAINT "whatsapp_session_handoff_state_check" CHECK ((state)::text = ANY ((ARRAY['requested'::character varying, 'draining'::character varying, 'transforming'::character varying, 'hydrating'::character varying, 'validating'::character varying, 'promoting'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))
);
-- Create index "whatsapp_session_handoff_active_uidx" to table: "whatsapp_session_handoff"
CREATE UNIQUE INDEX "whatsapp_session_handoff_active_uidx" ON "public"."whatsapp_session_handoff" ("session_id") WHERE ((state)::text = ANY ((ARRAY['requested'::character varying, 'draining'::character varying, 'transforming'::character varying, 'hydrating'::character varying, 'validating'::character varying, 'promoting'::character varying])::text[]));
-- Create index "whatsapp_session_handoff_dispatch_idx" to table: "whatsapp_session_handoff"
CREATE INDEX "whatsapp_session_handoff_dispatch_idx" ON "public"."whatsapp_session_handoff" ("next_attempt_at", "created_at", "session_id", "handoff_id") WHERE ((state)::text = 'requested'::text);
-- Create index "whatsapp_session_handoff_lifecycle_uidx" to table: "whatsapp_session_handoff"
CREATE UNIQUE INDEX "whatsapp_session_handoff_lifecycle_uidx" ON "public"."whatsapp_session_handoff" ("session_id", "lifecycle_operation_id") WHERE (lifecycle_operation_id IS NOT NULL);
-- Create index "whatsapp_session_handoff_gc_idx" to table: "whatsapp_session_handoff"
CREATE INDEX "whatsapp_session_handoff_gc_idx" ON "public"."whatsapp_session_handoff" ("completed_at", "session_id", "handoff_id") WHERE ((state)::text = ANY ((ARRAY['completed'::character varying, 'failed'::character varying])::text[]));
-- Create index "whatsapp_session_handoff_recovery_idx" to table: "whatsapp_session_handoff"
CREATE INDEX "whatsapp_session_handoff_recovery_idx" ON "public"."whatsapp_session_handoff" ("recovery_next_attempt_at", "session_id", "handoff_id") WHERE ((state)::text = 'failed'::text AND (recovery_state)::text = ANY ((ARRAY['pending'::character varying, 'dispatching'::character varying, 'running'::character varying])::text[]));

-- Any protocol rollback must durably schedule its matching control-plane
-- compensation in the same transaction. The recovery operation UUID is
-- stable across manager restarts and ambiguous queue publications.
CREATE OR REPLACE FUNCTION public.schedule_whatsapp_handoff_recovery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.state = 'failed' AND OLD.state IS DISTINCT FROM 'failed' THEN
    NEW.recovery_state := 'pending';
    NEW.recovery_operation_id := COALESCE(
      NEW.recovery_operation_id,
      gen_random_uuid()
    );
    NEW.recovery_cleanup_required := NULL;
    NEW.recovery_from_generation := NULL;
    NEW.recovery_attempt_count := 0;
    NEW.recovery_next_attempt_at := clock_timestamp();
    NEW.recovery_claim_token := NULL;
    NEW.recovery_claim_expires_at := NULL;
    NEW.recovery_last_error_code := NULL;
    NEW.recovery_started_at := NULL;
    NEW.recovery_completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.schedule_whatsapp_handoff_recovery() FROM PUBLIC;

CREATE TRIGGER whatsapp_session_handoff_recovery_trigger
BEFORE UPDATE OF state ON public.whatsapp_session_handoff
FOR EACH ROW
EXECUTE FUNCTION public.schedule_whatsapp_handoff_recovery();
-- Create "whatsapp_session_lease" table
CREATE TABLE "public"."whatsapp_session_lease" (
  "session_id" uuid NOT NULL,
  "owner_id" uuid NULL,
  "provider" character varying(20) NULL,
  "fencing_token" bigint NOT NULL DEFAULT 0,
  "generation" integer NOT NULL DEFAULT 1,
  "epoch" uuid NULL,
  "acquired_at" timestamptz NULL,
  "heartbeat_at" timestamptz NULL,
  "expires_at" timestamptz NULL,
  PRIMARY KEY ("session_id"),
  CONSTRAINT "whatsapp_session_lease_session_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_session" ("session_id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "whatsapp_session_lease_owner_fields_check" CHECK (((owner_id IS NULL) AND (provider IS NULL) AND (epoch IS NULL) AND (expires_at IS NULL)) OR ((owner_id IS NOT NULL) AND (provider IS NOT NULL) AND (epoch IS NOT NULL) AND (acquired_at IS NOT NULL) AND (heartbeat_at IS NOT NULL) AND (expires_at IS NOT NULL))),
  CONSTRAINT "whatsapp_session_lease_provider_check" CHECK ((provider IS NULL) OR ((provider)::text = ANY ((ARRAY['baileys'::character varying, 'wwebjs'::character varying, 'whatsmeow'::character varying])::text[]))),
  CONSTRAINT "whatsapp_session_lease_token_check" CHECK ((fencing_token >= 0) AND (generation > 0))
) WITH (fillfactor = 70, autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 5000, autovacuum_analyze_scale_factor = 0, autovacuum_analyze_threshold = 5000);
-- Create "whatsapp_signal_sessions" table
CREATE TABLE "public"."whatsapp_signal_sessions" (
  "session_id" uuid NOT NULL,
  "revision_id" bigint NOT NULL,
  "their_id" text NOT NULL,
  "session" bytea NULL,
  CONSTRAINT "whatsapp_signal_sessions_pk" PRIMARY KEY ("session_id", "revision_id", "their_id"),
  CONSTRAINT "whatsapp_signal_sessions_device_fk" FOREIGN KEY ("session_id", "revision_id") REFERENCES "public"."whatsapp_device" ("session_id", "revision_id") ON UPDATE NO ACTION ON DELETE CASCADE
) WITH (fillfactor = 80);
-- Drop "whatsmeow_lid_map" table
DROP TABLE "public"."whatsmeow_lid_map";
-- Drop "whatsmeow_privacy_tokens" table
DROP TABLE "public"."whatsmeow_privacy_tokens";
-- Drop "whatsmeow_version" table
DROP TABLE "public"."whatsmeow_version";
-- Drop "whatsmeow_app_state_mutation_macs" table
DROP TABLE "public"."whatsmeow_app_state_mutation_macs";
-- Drop "whatsmeow_app_state_version" table
DROP TABLE "public"."whatsmeow_app_state_version";
-- Drop "whatsmeow_app_state_sync_keys" table
DROP TABLE "public"."whatsmeow_app_state_sync_keys";
-- Drop "whatsmeow_chat_settings" table
DROP TABLE "public"."whatsmeow_chat_settings";
-- Drop "whatsmeow_contacts" table
DROP TABLE "public"."whatsmeow_contacts";
-- Drop "whatsmeow_event_buffer" table
DROP TABLE "public"."whatsmeow_event_buffer";
-- Drop "whatsmeow_identity_keys" table
DROP TABLE "public"."whatsmeow_identity_keys";
-- Drop "whatsmeow_message_secrets" table
DROP TABLE "public"."whatsmeow_message_secrets";
-- Drop "whatsmeow_nct_salt" table
DROP TABLE "public"."whatsmeow_nct_salt";
-- Drop "whatsmeow_pre_keys" table
DROP TABLE "public"."whatsmeow_pre_keys";
-- Drop "whatsmeow_retry_buffer" table
DROP TABLE "public"."whatsmeow_retry_buffer";
-- Drop "whatsmeow_sender_keys" table
DROP TABLE "public"."whatsmeow_sender_keys";
-- Drop "whatsmeow_sessions" table
DROP TABLE "public"."whatsmeow_sessions";
-- Drop "whatsmeow_device" table
DROP TABLE "public"."whatsmeow_device";
-- Drop "worker_baileys_session_record" table
DROP TABLE "public"."worker_baileys_session_record";
-- Drop "worker_whatsapp_session" table
DROP TABLE "public"."worker_whatsapp_session";
-- Drop "worker_whatsmeow_session_backup_chunk" table
DROP TABLE "public"."worker_whatsmeow_session_backup_chunk";
-- Drop "worker_whatsmeow_session_backup" table
DROP TABLE "public"."worker_whatsmeow_session_backup";
-- Drop "worker_wwebjs_session_chunk" table
DROP TABLE "public"."worker_wwebjs_session_chunk";
-- Drop "worker_wwebjs_session_snapshot" table
DROP TABLE "public"."worker_wwebjs_session_snapshot";
-- Drop "worker_whatsapp_session_revision" table
DROP TABLE "public"."worker_whatsapp_session_revision";

-- The canonical store has one schema/codec compatibility row.

INSERT INTO public."whatsapp_store_version" ("version", "compat") VALUES (16, 16);

-- Transaction scope signatures prevent a runtime from forging the custom GUC
-- values used by FORCE RLS. The secret is database-owned, has no runtime ACL
-- and is never returned by a callable function.
CREATE TABLE public.whatsapp_runtime_scope_secret (
  secret_id boolean NOT NULL DEFAULT true,
  secret bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT whatsapp_runtime_scope_secret_pk PRIMARY KEY (secret_id),
  CONSTRAINT whatsapp_runtime_scope_secret_singleton_check CHECK (secret_id),
  CONSTRAINT whatsapp_runtime_scope_secret_size_check CHECK (octet_length(secret) = 32)
);
INSERT INTO public.whatsapp_runtime_scope_secret (secret_id, secret)
VALUES (true, public.gen_random_bytes(32));
REVOKE ALL ON TABLE public.whatsapp_runtime_scope_secret FROM PUBLIC;

-- Every state row is isolated by transaction-local session and revision scope.
ALTER TABLE public."whatsapp_session_revision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_session_revision" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_isolation ON public."whatsapp_session_revision"
  USING (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid))
  WITH CHECK (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid));

ALTER TABLE public."whatsapp_session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_session" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_isolation ON public."whatsapp_session"
  USING (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid))
  WITH CHECK (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid));

ALTER TABLE public."whatsapp_session_lease" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_session_lease" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_isolation ON public."whatsapp_session_lease"
  USING (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid))
  WITH CHECK (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid));

ALTER TABLE public."whatsapp_session_handoff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_session_handoff" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_isolation ON public."whatsapp_session_handoff"
  USING (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid))
  WITH CHECK (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid));

ALTER TABLE public."whatsapp_artifact_blob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_artifact_blob" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_isolation ON public."whatsapp_artifact_blob"
  USING (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid))
  WITH CHECK (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid));

ALTER TABLE public."whatsapp_artifact_chunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_artifact_chunk" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_isolation ON public."whatsapp_artifact_chunk"
  USING (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid))
  WITH CHECK (session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid));

ALTER TABLE public."whatsapp_device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_device" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_device"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_identity_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_identity_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_identity_keys"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_pre_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_pre_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_pre_keys"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_signal_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_signal_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_signal_sessions"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_sender_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_sender_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_sender_keys"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_app_state_sync_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_app_state_sync_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_app_state_sync_keys"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_app_state_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_app_state_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_app_state_version"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_app_state_mutation_macs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_app_state_mutation_macs" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_app_state_mutation_macs"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_contacts"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_chat_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_chat_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_chat_settings"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_message_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_message_secrets" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_message_secrets"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_privacy_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_privacy_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_privacy_tokens"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_nct_salt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_nct_salt" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_nct_salt"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_lid_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_lid_map" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_lid_map"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_event_buffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_event_buffer" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_event_buffer"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_retry_buffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_retry_buffer" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_retry_buffer"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_provider_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_provider_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_provider_record"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

ALTER TABLE public."whatsapp_artifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_artifact" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_revision_isolation ON public."whatsapp_artifact"
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
  );

-- GC is a control-plane concern. Runtime workers can enqueue indirectly only
-- through the revision-status trigger; they never receive queue privileges.
ALTER TABLE public."whatsapp_session_gc_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."whatsapp_session_gc_queue" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_session_gc_owner_only ON public."whatsapp_session_gc_queue"
  USING (
    current_user = pg_catalog.pg_get_userbyid((
      SELECT relowner
      FROM pg_catalog.pg_class
      WHERE oid = 'public.whatsapp_session'::regclass
    ))
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((
      SELECT relowner
      FROM pg_catalog.pg_class
      WHERE oid = 'public.whatsapp_session'::regclass
    ))
  );

-- Queue terminal/orphan revisions at the point their status changes. The
-- trigger is SECURITY DEFINER so a correctly fenced runtime can update its
-- revision without gaining direct access to the manager-owned GC queue.
CREATE OR REPLACE FUNCTION public.sync_whatsapp_session_gc_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_eligible_at timestamptz;
  v_status_changed boolean;
BEGIN
  v_status_changed := CASE
    WHEN TG_OP = 'INSERT' THEN true
    ELSE OLD.status IS DISTINCT FROM NEW.status
  END;

  IF NEW.status = 'staging' THEN
    v_eligible_at := CASE
      WHEN v_status_changed AND TG_OP = 'UPDATE'
        THEN statement_timestamp() + interval '72 hours'
      ELSE NEW.created_at + interval '72 hours'
    END;
  ELSIF NEW.status = 'failed' THEN
    v_eligible_at := COALESCE(
      NEW.retired_at,
      CASE WHEN v_status_changed THEN statement_timestamp() ELSE NEW.created_at END
    ) + interval '72 hours';
  ELSIF NEW.status = 'retired' THEN
    v_eligible_at := COALESCE(
      NEW.retired_at,
      CASE WHEN v_status_changed THEN statement_timestamp() ELSE NEW.created_at END
    ) + interval '7 days';
  ELSE
    DELETE FROM public.whatsapp_session_gc_queue AS queue
    WHERE queue.session_id = NEW.session_id
      AND queue.revision_id = NEW.revision_id;
    RETURN NEW;
  END IF;

  INSERT INTO public.whatsapp_session_gc_queue (
    session_id,
    revision_id,
    revision_status,
    eligible_at,
    claim_token,
    claim_expires_at,
    attempt_count,
    last_error_code,
    created_at,
    updated_at
  ) VALUES (
    NEW.session_id,
    NEW.revision_id,
    NEW.status,
    v_eligible_at,
    NULL,
    NULL,
    0,
    NULL,
    statement_timestamp(),
    statement_timestamp()
  )
  ON CONFLICT (session_id, revision_id) DO UPDATE
  SET revision_status = EXCLUDED.revision_status,
      eligible_at = EXCLUDED.eligible_at,
      claim_token = NULL,
      claim_expires_at = NULL,
      attempt_count = 0,
      last_error_code = NULL,
      updated_at = statement_timestamp();

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_whatsapp_session_gc_queue() FROM PUBLIC;

CREATE TRIGGER whatsapp_session_revision_gc_queue_sync
AFTER INSERT OR UPDATE OF status, retired_at
ON public.whatsapp_session_revision
FOR EACH ROW
EXECUTE FUNCTION public.sync_whatsapp_session_gc_queue();

-- Runtime writers may persist metadata and advance a hydrated candidate, but
-- terminal lifecycle states belong exclusively to the SECURITY DEFINER
-- promote/rollback APIs. This blocks a compromised provider from completing
-- or failing a handoff (or retiring/activating a revision) with direct DML.
CREATE OR REPLACE FUNCTION public.enforce_whatsapp_runtime_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_table_owner name;
  v_old_rank integer;
  v_new_rank integer;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(class.relowner)
  INTO STRICT v_table_owner
  FROM pg_catalog.pg_class AS class
  WHERE class.oid = TG_RELID;

  IF current_user = v_table_owner THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'whatsapp_session_revision' THEN
    IF NEW.status = OLD.status
      OR (OLD.status = 'staging' AND NEW.status = 'validating')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'runtime cannot perform whatsapp revision state transition % -> %',
      OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'whatsapp_session_handoff' THEN
    v_old_rank := CASE OLD.state
      WHEN 'requested' THEN 1
      WHEN 'draining' THEN 2
      WHEN 'transforming' THEN 3
      WHEN 'hydrating' THEN 4
      WHEN 'validating' THEN 5
      WHEN 'promoting' THEN 6
      ELSE NULL
    END;
    v_new_rank := CASE NEW.state
      WHEN 'requested' THEN 1
      WHEN 'draining' THEN 2
      WHEN 'transforming' THEN 3
      WHEN 'hydrating' THEN 4
      WHEN 'validating' THEN 5
      WHEN 'promoting' THEN 6
      ELSE NULL
    END;
    IF v_old_rank IS NOT NULL
      AND v_new_rank IS NOT NULL
      AND v_new_rank >= v_old_rank
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'runtime cannot perform whatsapp handoff state transition % -> %',
      OLD.state, NEW.state
      USING ERRCODE = '42501';
  END IF;

  RAISE EXCEPTION 'unsupported whatsapp lifecycle transition table'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_whatsapp_runtime_state_transition()
  FROM PUBLIC;

CREATE TRIGGER whatsapp_session_revision_runtime_state_guard
BEFORE UPDATE OF status
ON public.whatsapp_session_revision
FOR EACH ROW
EXECUTE FUNCTION public.enforce_whatsapp_runtime_state_transition();

CREATE TRIGGER whatsapp_session_handoff_runtime_state_guard
BEFORE UPDATE OF state
ON public.whatsapp_session_handoff
FOR EACH ROW
EXECUTE FUNCTION public.enforce_whatsapp_runtime_state_transition();


-- This helper is deliberately not granted to the runtime role. Only a
-- SECURITY DEFINER entry point that has already locked and validated the
-- lease may mint the transaction/backend-bound RLS signature.
CREATE OR REPLACE FUNCTION public.issue_whatsapp_runtime_scope_signature()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_secret bytea;
  v_payload text;
BEGIN
  SELECT scope_secret.secret
  INTO STRICT v_secret
  FROM public.whatsapp_runtime_scope_secret AS scope_secret
  WHERE scope_secret.secret_id;

  v_payload := array_to_string(ARRAY[
    current_database(),
    pg_backend_pid()::text,
    txid_current()::text,
    COALESCE(current_setting('app.whatsapp_session_id', true), ''),
    COALESCE(current_setting('app.whatsapp_revision_id', true), ''),
    COALESCE(current_setting('app.whatsapp_owner_id', true), ''),
    COALESCE(current_setting('app.whatsapp_fencing_token', true), ''),
    COALESCE(current_setting('app.whatsapp_generation', true), ''),
    COALESCE(current_setting('app.whatsapp_epoch', true), ''),
    COALESCE(current_setting('app.whatsapp_capability', true), ''),
    COALESCE(current_setting('app.whatsapp_lease_provider', true), ''),
    COALESCE(current_setting('app.whatsapp_provider', true), '')
  ], chr(31));

  PERFORM set_config(
    'app.whatsapp_scope_signature',
    encode(public.hmac(convert_to(v_payload, 'UTF8'), v_secret, 'sha256'), 'hex'),
    true
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_whatsapp_runtime_scope_signature() FROM PUBLIC;

-- Providers serialize the same phone companion differently (for example
-- 5511@c.us versus 5511:4@s.whatsapp.net). Keep the stored value provider-
-- native, but compare a stable PN form during handoff validation.
CREATE OR REPLACE FUNCTION public.normalize_whatsapp_companion_jid(p_jid text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT regexp_replace(
    regexp_replace(lower(trim(p_jid)), ':[0-9]+@', '@'),
    '@c[.]us$',
    '@s.whatsapp.net'
  );
$function$;

-- A custom GUC alone is user-settable. Bind every direct state access to a
-- database-signed scope minted only after begin_whatsapp_session_operation
-- locked the live lease for the duration of the transaction.
CREATE OR REPLACE FUNCTION public.whatsapp_runtime_scope_is_valid()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH scope AS (
  SELECT
    nullif(current_setting('app.whatsapp_session_id', true), '')::uuid AS session_id,
    nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint AS revision_id,
    nullif(current_setting('app.whatsapp_owner_id', true), '')::uuid AS owner_id,
    nullif(current_setting('app.whatsapp_fencing_token', true), '')::bigint AS fencing_token,
    nullif(current_setting('app.whatsapp_generation', true), '')::integer AS generation,
    nullif(current_setting('app.whatsapp_epoch', true), '')::uuid AS epoch,
    nullif(current_setting('app.whatsapp_capability', true), '') AS capability,
    nullif(current_setting('app.whatsapp_lease_provider', true), '') AS lease_provider,
    nullif(current_setting('app.whatsapp_provider', true), '') AS data_provider,
    nullif(current_setting('app.whatsapp_scope_signature', true), '') AS scope_signature
),
scope_secret AS (
  SELECT secret
  FROM public.whatsapp_runtime_scope_secret
  WHERE secret_id
)
SELECT EXISTS (
  SELECT 1
  FROM scope
  CROSS JOIN scope_secret
  JOIN public.whatsapp_session_lease AS lease
    ON lease.session_id = scope.session_id
  JOIN public.whatsapp_session AS session
    ON session.session_id = lease.session_id
  LEFT JOIN public.whatsapp_session_revision AS revision
    ON scope.revision_id IS NOT NULL
   AND revision.session_id = scope.session_id
   AND revision.revision_id = scope.revision_id
  WHERE scope.session_id IS NOT NULL
    AND scope.owner_id IS NOT NULL
    AND scope.fencing_token > 0
    AND scope.generation > 0
    AND scope.epoch IS NOT NULL
    AND length(scope.capability) BETWEEN 32 AND 512
    AND scope.lease_provider IN ('baileys', 'wwebjs', 'whatsmeow')
    AND scope.data_provider IN ('baileys', 'wwebjs', 'whatsmeow')
    AND scope.scope_signature = encode(
      public.hmac(
        convert_to(
          array_to_string(ARRAY[
            current_database(),
            pg_backend_pid()::text,
            txid_current()::text,
            COALESCE(scope.session_id::text, ''),
            COALESCE(scope.revision_id::text, ''),
            COALESCE(scope.owner_id::text, ''),
            COALESCE(scope.fencing_token::text, ''),
            COALESCE(scope.generation::text, ''),
            COALESCE(scope.epoch::text, ''),
            COALESCE(scope.capability, ''),
            COALESCE(scope.lease_provider, ''),
            COALESCE(scope.data_provider, '')
          ], chr(31)),
          'UTF8'
        ),
        scope_secret.secret,
        'sha256'
      ),
      'hex'
    )
    AND lease.owner_id = scope.owner_id
    AND lease.provider = scope.lease_provider
    AND lease.fencing_token = scope.fencing_token
    AND lease.generation = scope.generation
    AND lease.epoch = scope.epoch
    AND lease.expires_at > clock_timestamp()
    AND session.generation = scope.generation
    AND session.epoch = scope.epoch
    AND session.capability_hash = encode(
      public.digest(scope.capability, 'sha256'), 'hex'
    )
    AND (
      (
        session.provider = scope.lease_provider
        AND (
          session.state <> 'handoff'
          OR EXISTS (
            SELECT 1
            FROM public.whatsapp_session_handoff AS source_handoff
            WHERE source_handoff.session_id = session.session_id
              AND source_handoff.source_provider = scope.lease_provider
              AND source_handoff.state IN ('requested', 'draining')
          )
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.whatsapp_session_handoff AS target_handoff
        WHERE target_handoff.session_id = session.session_id
          AND target_handoff.target_provider = scope.lease_provider
          AND target_handoff.state IN (
            'transforming', 'hydrating', 'validating', 'promoting'
          )
      )
    )
    AND (
      scope.revision_id IS NULL
      OR (
        revision.provider = scope.data_provider
        AND revision.capability_hash = encode(
          public.digest(scope.capability, 'sha256'), 'hex'
        )
        AND revision.status IN ('staging', 'validating', 'active')
        AND (
          (
            session.state <> 'handoff'
            AND session.active_revision_id = revision.revision_id
          )
          OR (
            session.state = 'handoff'
            AND session.active_revision_id = revision.revision_id
            AND EXISTS (
              SELECT 1
              FROM public.whatsapp_session_handoff AS source_handoff
              WHERE source_handoff.session_id = session.session_id
                AND source_handoff.source_revision_id = revision.revision_id
                AND source_handoff.source_provider = scope.lease_provider
              AND source_handoff.state IN ('requested', 'draining')
            )
          )
          OR (
            current_setting('transaction_read_only') = 'on'
            AND session.state = 'handoff'
            AND session.active_revision_id = revision.revision_id
            AND EXISTS (
              SELECT 1
              FROM public.whatsapp_session_handoff AS conversion_handoff
              WHERE conversion_handoff.session_id = session.session_id
                AND conversion_handoff.source_revision_id = revision.revision_id
                AND conversion_handoff.source_provider = scope.data_provider
                AND conversion_handoff.target_provider = scope.lease_provider
                AND conversion_handoff.state IN (
                  'transforming', 'hydrating', 'validating', 'promoting'
                )
            )
          )
          OR EXISTS (
            SELECT 1
            FROM public.whatsapp_session_handoff AS revision_handoff
            WHERE revision_handoff.session_id = session.session_id
              AND revision_handoff.target_revision_id = revision.revision_id
              AND revision_handoff.target_provider = scope.lease_provider
              AND revision_handoff.state IN (
                'transforming', 'hydrating', 'validating', 'promoting'
              )
          )
          OR (
            session.state <> 'handoff'
            AND session.active_revision_id IS NULL
            AND revision.status = 'staging'
          )
        )
      )
    )
);
$function$;

-- RLS evaluates this predicate as the runtime role; expose it only to that
-- closed role later, never to PUBLIC.
REVOKE ALL ON FUNCTION public.whatsapp_runtime_scope_is_valid() FROM PUBLIC;

-- Chunks and their content-addressed blobs are deduplicated inside a session,
-- but a runtime must only enumerate bytes reachable from its exact revision.
-- The authorized source-reader installs the source revision as its exact
-- transaction scope and is read-only. Previous/unrelated revisions remain
-- invisible even though they share the same session_id.
CREATE OR REPLACE FUNCTION public.whatsapp_artifact_is_visible(
  p_session_id uuid,
  p_artifact_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
SELECT
  p_session_id = nullif(current_setting('app.whatsapp_session_id', true), '')::uuid
  AND public.whatsapp_runtime_scope_is_valid()
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_artifact AS artifact
    WHERE artifact.session_id = p_session_id
      AND artifact.artifact_id = p_artifact_id
      AND artifact.revision_id = nullif(
        current_setting('app.whatsapp_revision_id', true), ''
      )::bigint
  );
$function$;
REVOKE ALL ON FUNCTION public.whatsapp_artifact_is_visible(uuid, uuid)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.whatsapp_artifact_blob_is_visible(
  p_session_id uuid,
  p_sha256 text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
SELECT
  p_session_id = nullif(current_setting('app.whatsapp_session_id', true), '')::uuid
  AND public.whatsapp_runtime_scope_is_valid()
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_artifact_chunk AS chunk
    WHERE chunk.session_id = p_session_id
      AND chunk.sha256 = p_sha256
      AND public.whatsapp_artifact_is_visible(
        chunk.session_id,
        chunk.artifact_id
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.whatsapp_artifact_blob_is_visible(uuid, text)
  FROM PUBLIC;

ALTER POLICY whatsapp_session_isolation ON public."whatsapp_session_revision"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_isolation ON public."whatsapp_session"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_isolation ON public."whatsapp_session_lease"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

DROP POLICY whatsapp_session_isolation ON public."whatsapp_session_handoff";
CREATE POLICY whatsapp_session_handoff_owner ON public."whatsapp_session_handoff"
  FOR ALL
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
  );
CREATE POLICY whatsapp_session_handoff_runtime_select ON public."whatsapp_session_handoff"
  FOR SELECT
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND (SELECT public.whatsapp_runtime_scope_is_valid())
  );
CREATE POLICY whatsapp_session_handoff_runtime_update ON public."whatsapp_session_handoff"
  FOR UPDATE
  USING (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND target_revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
    AND (SELECT public.whatsapp_runtime_scope_is_valid())
  )
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND target_revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
    AND (SELECT public.whatsapp_runtime_scope_is_valid())
  );

DROP POLICY whatsapp_session_isolation ON public."whatsapp_artifact_blob";
CREATE POLICY whatsapp_artifact_blob_owner ON public."whatsapp_artifact_blob"
  FOR ALL
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
  );
CREATE POLICY whatsapp_artifact_blob_runtime_select ON public."whatsapp_artifact_blob"
  FOR SELECT
  USING (
    public.whatsapp_artifact_blob_is_visible(session_id, sha256)
  );
CREATE POLICY whatsapp_artifact_blob_runtime_insert ON public."whatsapp_artifact_blob"
  FOR INSERT
  WITH CHECK (
    session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
    AND (SELECT public.whatsapp_runtime_scope_is_valid())
    AND sha256 = encode(public.digest(payload, 'sha256'), 'hex')
  );

DROP POLICY whatsapp_session_isolation ON public."whatsapp_artifact_chunk";
CREATE POLICY whatsapp_artifact_chunk_owner ON public."whatsapp_artifact_chunk"
  FOR ALL
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
  );
CREATE POLICY whatsapp_artifact_chunk_runtime ON public."whatsapp_artifact_chunk"
  FOR ALL
  USING (
    public.whatsapp_artifact_is_visible(session_id, artifact_id)
  )
  WITH CHECK (
    public.whatsapp_artifact_is_visible(session_id, artifact_id)
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_device"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_identity_keys"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_pre_keys"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_signal_sessions"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_sender_keys"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_app_state_sync_keys"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_app_state_version"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_app_state_mutation_macs"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_contacts"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_chat_settings"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_message_secrets"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_privacy_tokens"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_nct_salt"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_lid_map"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_event_buffer"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_retry_buffer"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_provider_record"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

ALTER POLICY whatsapp_session_revision_isolation ON public."whatsapp_artifact"
  USING (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  )
  WITH CHECK (
    current_user = pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_catalog.pg_class WHERE oid = 'public.whatsapp_session'::regclass))
    OR (
      session_id = (SELECT nullif(current_setting('app.whatsapp_session_id', true), '')::uuid)
      AND revision_id = (SELECT nullif(current_setting('app.whatsapp_revision_id', true), '')::bigint)
      AND (SELECT public.whatsapp_runtime_scope_is_valid())
    )
  );

-- Lease, revision, handoff and runtime-fence APIs.
CREATE OR REPLACE FUNCTION public.acquire_whatsapp_session_lease(p_session_id uuid, p_owner_id uuid, p_provider text, p_generation integer, p_epoch uuid, p_ttl_ms integer, p_capability text)
 RETURNS TABLE(fencing_token bigint, expires_at timestamp with time zone, remaining_ms bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_owner_id IS NULL OR p_epoch IS NULL
    OR p_generation <= 0 OR p_ttl_ms < 5000 OR p_ttl_ms > 300000
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR lower(trim(p_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')
  THEN
    RAISE EXCEPTION 'invalid whatsapp session lease acquisition arguments'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  v_expires_at := v_now + (p_ttl_ms::text || ' milliseconds')::interval;

  INSERT INTO public.whatsapp_session_lease (
    session_id, fencing_token, generation
  )
  SELECT p_session_id, 0, p_generation
  FROM public.whatsapp_session AS session
  WHERE session.session_id = p_session_id
  ON CONFLICT (session_id) DO NOTHING;

  RETURN QUERY
  UPDATE public.whatsapp_session_lease AS lease
  SET owner_id = p_owner_id,
      provider = lower(trim(p_provider)),
      fencing_token = lease.fencing_token + 1,
      generation = p_generation,
      epoch = p_epoch,
      acquired_at = v_now,
      heartbeat_at = v_now,
      expires_at = v_expires_at
  FROM public.whatsapp_session AS session
  WHERE lease.session_id = p_session_id
    AND session.session_id = lease.session_id
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND (
      (
        session.provider = lower(trim(p_provider))
        AND (
          session.state <> 'handoff'
          OR EXISTS (
            SELECT 1
            FROM public.whatsapp_session_handoff AS source_handoff
            WHERE source_handoff.session_id = session.session_id
              AND source_handoff.source_provider = lower(trim(p_provider))
              AND source_handoff.state IN ('requested', 'draining')
          )
        )
      )
      OR (
        session.state = 'handoff'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS target_handoff
          WHERE target_handoff.session_id = session.session_id
            AND target_handoff.target_provider = lower(trim(p_provider))
            AND target_handoff.state IN ('transforming', 'hydrating', 'validating', 'promoting')
        )
      )
    )
    AND (
      lease.owner_id IS NULL
      OR lease.expires_at <= v_now
      OR (
        lease.owner_id = p_owner_id
        AND lease.generation = p_generation
        AND lease.epoch = p_epoch
      )
    )
  RETURNING lease.fencing_token,
    lease.expires_at,
    GREATEST(0, floor(extract(epoch FROM (lease.expires_at - v_now)) * 1000))::bigint;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session lease is held or session fence is stale'
      USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.renew_whatsapp_session_lease(p_session_id uuid, p_owner_id uuid, p_provider text, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_ttl_ms integer, p_capability text)
 RETURNS TABLE(fencing_token bigint, expires_at timestamp with time zone, remaining_ms bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_owner_id IS NULL OR p_epoch IS NULL
    OR p_fencing_token <= 0 OR p_generation <= 0
    OR p_ttl_ms < 5000 OR p_ttl_ms > 300000
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR lower(trim(p_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')
  THEN
    RAISE EXCEPTION 'invalid whatsapp session lease renewal arguments'
      USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  v_expires_at := v_now + (p_ttl_ms::text || ' milliseconds')::interval;

  RETURN QUERY
  UPDATE public.whatsapp_session_lease AS lease
  SET heartbeat_at = v_now,
      expires_at = v_expires_at
  FROM public.whatsapp_session AS session
  WHERE lease.session_id = p_session_id
    AND session.session_id = lease.session_id
    AND lease.owner_id = p_owner_id
    AND lease.provider = lower(trim(p_provider))
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > v_now
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND (
      (
        session.provider = lower(trim(p_provider))
        AND (
          session.state <> 'handoff'
          OR EXISTS (
            SELECT 1
            FROM public.whatsapp_session_handoff AS source_handoff
            WHERE source_handoff.session_id = session.session_id
              AND source_handoff.source_provider = lower(trim(p_provider))
              AND source_handoff.state IN ('requested', 'draining')
          )
        )
      )
      OR (
        session.state = 'handoff'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS target_handoff
          WHERE target_handoff.session_id = session.session_id
            AND target_handoff.target_provider = lower(trim(p_provider))
            AND target_handoff.state IN ('transforming', 'hydrating', 'validating', 'promoting')
        )
      )
    )
  RETURNING lease.fencing_token,
    lease.expires_at,
    GREATEST(0, floor(extract(epoch FROM (lease.expires_at - v_now)) * 1000))::bigint;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session lease was lost'
      USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_whatsapp_session_lease(p_session_id uuid, p_owner_id uuid, p_provider text, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_owner_id IS NULL OR p_epoch IS NULL
    OR p_fencing_token <= 0 OR p_generation <= 0
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR lower(trim(p_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')
  THEN
    RAISE EXCEPTION 'invalid whatsapp session lease release arguments'
      USING ERRCODE = '22023';
  END IF;
  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  UPDATE public.whatsapp_session_lease AS lease
  SET owner_id = NULL,
      provider = NULL,
      epoch = NULL,
      acquired_at = NULL,
      heartbeat_at = NULL,
      expires_at = NULL
  FROM public.whatsapp_session AS session
  WHERE lease.session_id = p_session_id
    AND session.session_id = lease.session_id
    AND lease.owner_id = p_owner_id
    AND lease.provider = lower(trim(p_provider))
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash;
  IF FOUND THEN
    RETURN true;
  END IF;

  -- The release may have committed while its response was lost. Confirm only
  -- the exact already-cleared fencing token; a takeover increments the token
  -- and therefore can never be mistaken for this caller's release.
  RETURN EXISTS (
    SELECT 1
    FROM public.whatsapp_session_lease AS lease
    JOIN public.whatsapp_session AS session
      ON session.session_id = lease.session_id
    WHERE lease.session_id = p_session_id
      AND lease.fencing_token = p_fencing_token
      AND lease.generation = p_generation
      AND lease.owner_id IS NULL
      AND lease.provider IS NULL
      AND lease.epoch IS NULL
      AND lease.acquired_at IS NULL
      AND lease.heartbeat_at IS NULL
      AND lease.expires_at IS NULL
      AND session.generation = p_generation
      AND session.epoch = p_epoch
      AND session.capability_hash = v_capability_hash
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.begin_whatsapp_session_operation(p_session_id uuid, p_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_provider text;
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_revision_id IS NULL OR p_owner_id IS NULL
    OR p_epoch IS NULL OR p_fencing_token <= 0 OR p_generation <= 0
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
  THEN
    RAISE EXCEPTION 'invalid whatsapp session operation arguments'
      USING ERRCODE = '22023';
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  -- Install the requested scope before touching FORCE RLS tables. The values
  -- are transaction-local and are accepted only if the lease/fence join below
  -- succeeds; direct state access remains bound to this leased transaction.
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM set_config('app.whatsapp_revision_id', p_revision_id::text, true);

  SELECT lease.provider
  INTO v_provider
  FROM public.whatsapp_session_lease AS lease
  JOIN public.whatsapp_session AS session
    ON session.session_id = lease.session_id
  JOIN public.whatsapp_session_revision AS revision
    ON revision.session_id = session.session_id
   AND revision.revision_id = p_revision_id
  WHERE lease.session_id = p_session_id
    AND lease.owner_id = p_owner_id
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > clock_timestamp()
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND revision.provider = lease.provider
    AND revision.writer_generation = p_generation
    AND revision.writer_epoch = p_epoch
    AND revision.capability_hash = v_capability_hash
    AND revision.status IN ('staging', 'validating', 'active')
    AND (
      (
        session.state <> 'handoff'
        AND session.active_revision_id = revision.revision_id
      )
      OR (
        session.state = 'handoff'
        AND session.active_revision_id = revision.revision_id
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS source_handoff
          WHERE source_handoff.session_id = session.session_id
            AND source_handoff.source_revision_id = revision.revision_id
            AND source_handoff.source_provider = lease.provider
            AND source_handoff.state IN ('requested', 'draining')
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.whatsapp_session_handoff AS target_handoff
        WHERE target_handoff.session_id = session.session_id
          AND target_handoff.target_revision_id = revision.revision_id
          AND target_handoff.target_provider = lease.provider
          AND target_handoff.state IN ('transforming', 'hydrating', 'validating', 'promoting')
      )
      OR (
        session.state <> 'handoff'
        AND session.active_revision_id IS NULL
        AND revision.status = 'staging'
      )
    )
  FOR SHARE OF lease, session, revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session operation'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.whatsapp_fencing_token', p_fencing_token::text, true);
  PERFORM set_config('app.whatsapp_owner_id', p_owner_id::text, true);
  PERFORM set_config('app.whatsapp_generation', p_generation::text, true);
  PERFORM set_config('app.whatsapp_epoch', p_epoch::text, true);
  PERFORM set_config('app.whatsapp_capability', p_capability, true);
  PERFORM set_config('app.whatsapp_lease_provider', v_provider, true);
  PERFORM set_config('app.whatsapp_provider', v_provider, true);
  PERFORM public.issue_whatsapp_runtime_scope_signature();
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.begin_whatsapp_handoff_source_read(p_session_id uuid, p_target_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text, p_provider text)
 RETURNS TABLE(source_provider text, source_revision_id bigint, target_provider text, target_revision_id bigint, handoff_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_capability_hash text;
BEGIN
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'whatsapp handoff source reads require a read-only transaction'
      USING ERRCODE = '25006';
  END IF;

  IF p_session_id IS NULL OR p_target_revision_id IS NULL
    OR p_owner_id IS NULL OR p_fencing_token <= 0
    OR p_generation <= 0 OR p_epoch IS NULL
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR lower(trim(p_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')
  THEN
    RAISE EXCEPTION 'invalid whatsapp handoff source read arguments'
      USING ERRCODE = '22023';
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);

  RETURN QUERY
  SELECT source_revision.provider::text,
    source_revision.revision_id,
    target_revision.provider::text,
    target_revision.revision_id,
    handoff.handoff_id
  FROM public.whatsapp_session_lease AS lease
  JOIN public.whatsapp_session AS session
    ON session.session_id = lease.session_id
  JOIN public.whatsapp_session_handoff AS handoff
    ON handoff.session_id = session.session_id
   AND handoff.source_revision_id = session.active_revision_id
   AND handoff.target_revision_id = p_target_revision_id
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = handoff.session_id
   AND source_revision.revision_id = handoff.source_revision_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  WHERE lease.session_id = p_session_id
    AND lease.owner_id = p_owner_id
    AND lease.provider = lower(trim(p_provider))
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > clock_timestamp()
    AND session.state = 'handoff'
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND handoff.target_provider = lower(trim(p_provider))
    AND handoff.state IN (
      'transforming', 'hydrating', 'validating', 'promoting'
    )
    AND source_revision.provider = handoff.source_provider
    AND source_revision.status = 'active'
    AND source_revision.capability_hash = v_capability_hash
    AND target_revision.provider = handoff.target_provider
    AND target_revision.status IN ('staging', 'validating')
    AND target_revision.capability_hash = v_capability_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp handoff source read'
      USING ERRCODE = '55000';
  END IF;

  -- Install the immutable source projection scope for all following reads in
  -- this read-only transaction. Conversion and hashing happen after COMMIT.
  SELECT handoff.source_provider::text, handoff.source_revision_id
  INTO source_provider, source_revision_id
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.target_revision_id = p_target_revision_id
    AND handoff.state IN (
      'transforming', 'hydrating', 'validating', 'promoting'
    );
  PERFORM set_config('app.whatsapp_revision_id', source_revision_id::text, true);
  PERFORM set_config('app.whatsapp_owner_id', p_owner_id::text, true);
  PERFORM set_config('app.whatsapp_fencing_token', p_fencing_token::text, true);
  PERFORM set_config('app.whatsapp_generation', p_generation::text, true);
  PERFORM set_config('app.whatsapp_epoch', p_epoch::text, true);
  PERFORM set_config('app.whatsapp_capability', p_capability, true);
  PERFORM set_config('app.whatsapp_lease_provider', lower(trim(p_provider)), true);
  PERFORM set_config('app.whatsapp_provider', source_provider, true);
  PERFORM public.issue_whatsapp_runtime_scope_signature();
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_whatsapp_session_revision(p_session_id uuid, p_owner_id uuid, p_provider text, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text, p_source text DEFAULT 'pairing'::text, p_schema_version integer DEFAULT 16, p_codec_version integer DEFAULT 1, p_format text DEFAULT 'whatsapp-canonical-v1'::text)
 RETURNS TABLE(revision_id bigint, status text, handoff_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_revision_id bigint;
  v_status text;
  v_active_revision_id bigint;
  v_session_provider text;
  v_session_state text;
  v_handoff_id uuid;
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_owner_id IS NULL OR p_epoch IS NULL
    OR p_fencing_token <= 0 OR p_generation <= 0
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR lower(trim(p_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')
    OR lower(trim(p_source)) NOT IN ('pairing', 'checkpoint', 'secure_import', 'handoff', 'rollback')
    OR p_schema_version <= 0 OR p_codec_version <= 0 OR trim(p_format) = ''
  THEN
    RAISE EXCEPTION 'invalid whatsapp session revision arguments'
      USING ERRCODE = '22023';
  END IF;

  p_provider := lower(trim(p_provider));
  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);

  SELECT session.active_revision_id, session.provider, session.state
  INTO v_active_revision_id, v_session_provider, v_session_state
  FROM public.whatsapp_session_lease AS lease
  JOIN public.whatsapp_session AS session
    ON session.session_id = lease.session_id
  WHERE lease.session_id = p_session_id
    AND lease.owner_id = p_owner_id
    AND lease.provider = p_provider
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > clock_timestamp()
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND (
      session.provider = p_provider
      OR (
        session.state = 'handoff'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS active_handoff
          WHERE active_handoff.session_id = session.session_id
            AND active_handoff.target_provider = p_provider
            AND active_handoff.state IN (
              'transforming', 'hydrating', 'validating', 'promoting'
            )
        )
      )
    )
  FOR SHARE OF lease
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session revision open'
      USING ERRCODE = '55000';
  END IF;

  IF v_session_provider <> p_provider THEN
    SELECT handoff.target_revision_id, target_revision.status, handoff.handoff_id
    INTO v_revision_id, v_status, v_handoff_id
    FROM public.whatsapp_session_handoff AS handoff
    JOIN public.whatsapp_session_revision AS target_revision
      ON target_revision.session_id = handoff.session_id
     AND target_revision.revision_id = handoff.target_revision_id
    WHERE handoff.session_id = p_session_id
      AND handoff.source_revision_id = v_active_revision_id
      AND handoff.target_provider = p_provider
      AND handoff.state IN (
        'transforming', 'hydrating', 'validating', 'promoting'
      )
      AND target_revision.provider = p_provider
      AND target_revision.status IN ('staging', 'validating')
    FOR UPDATE OF target_revision;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'whatsapp handoff candidate is unavailable'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.whatsapp_session_revision AS writable_revision
    SET writer_generation = p_generation,
        writer_epoch = p_epoch,
        capability_hash = v_capability_hash
    WHERE writable_revision.session_id = p_session_id
      AND writable_revision.revision_id = v_revision_id;

    PERFORM set_config('app.whatsapp_revision_id', v_revision_id::text, true);
    RETURN QUERY SELECT v_revision_id, v_status, v_handoff_id;
    RETURN;
  END IF;

  IF v_active_revision_id IS NOT NULL THEN
    PERFORM set_config('app.whatsapp_revision_id', v_active_revision_id::text, true);
    SELECT revision.revision_id, revision.status
    INTO v_revision_id, v_status
    FROM public.whatsapp_session_revision AS revision
    WHERE revision.session_id = p_session_id
      AND revision.revision_id = v_active_revision_id
      AND revision.provider = p_provider
      AND revision.status IN ('staging', 'validating', 'active')
    FOR UPDATE;
    IF FOUND THEN
      UPDATE public.whatsapp_session_revision AS writable_revision
      SET writer_generation = p_generation,
          writer_epoch = p_epoch,
          capability_hash = v_capability_hash
      WHERE writable_revision.session_id = p_session_id
        AND writable_revision.revision_id = v_revision_id;
      RETURN QUERY SELECT v_revision_id, v_status, NULL::uuid;
      RETURN;
    END IF;
    RAISE EXCEPTION 'active whatsapp session revision is not writable'
      USING ERRCODE = '55000';
  END IF;

  v_revision_id := nextval(
    pg_get_serial_sequence('public.whatsapp_session_revision', 'revision_id')
  );
  PERFORM set_config('app.whatsapp_revision_id', v_revision_id::text, true);
  INSERT INTO public.whatsapp_session_revision (
    session_id, revision_id, provider, status, source,
    schema_version, codec_version, format, writer_generation,
    writer_epoch, capability_hash
  ) VALUES (
    p_session_id, v_revision_id, p_provider, 'staging',
    lower(trim(p_source)), p_schema_version, p_codec_version, trim(p_format),
    p_generation, p_epoch, v_capability_hash
  );

  UPDATE public.whatsapp_session
  SET state = 'preparing',
      active_revision_id = v_revision_id,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND provider = p_provider
    AND active_revision_id IS NULL
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed while opening revision'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT v_revision_id, 'staging'::text, NULL::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_whatsapp_session_candidate(p_session_id uuid, p_expected_active_revision_id bigint, p_owner_id uuid, p_target_provider text, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text, p_source text, p_schema_version integer, p_codec_version integer, p_format text)
 RETURNS TABLE(revision_id bigint, handoff_id uuid, source_revision_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_provider text;
  v_revision_id bigint;
  v_handoff_id uuid := gen_random_uuid();
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_expected_active_revision_id IS NULL
    OR p_owner_id IS NULL OR p_epoch IS NULL OR p_fencing_token <= 0
    OR p_generation <= 0 OR p_capability IS NULL
    OR length(p_capability) < 32 OR length(p_capability) > 512
    OR lower(trim(p_target_provider)) NOT IN ('baileys', 'wwebjs', 'whatsmeow')
    -- A runtime may stage only a same-provider secure import. Cross-provider
    -- candidates are a control-plane operation and are created exclusively by
    -- request_whatsapp_provider_handoff after validating worker lifecycle,
    -- target type and PostgreSQL session storage.
    OR lower(trim(p_source)) <> 'secure_import'
    OR p_schema_version <= 0 OR p_codec_version <= 0 OR trim(p_format) = ''
  THEN
    RAISE EXCEPTION 'invalid whatsapp session candidate arguments'
      USING ERRCODE = '22023';
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  SELECT lease.provider
  INTO v_source_provider
  FROM public.whatsapp_session_lease AS lease
  JOIN public.whatsapp_session AS session
    ON session.session_id = lease.session_id
  WHERE lease.session_id = p_session_id
    AND lease.owner_id = p_owner_id
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > clock_timestamp()
    AND session.provider = lease.provider
    AND session.active_revision_id = p_expected_active_revision_id
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND session.state <> 'handoff'
  FOR SHARE OF lease
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session candidate creation'
      USING ERRCODE = '55000';
  END IF;
  IF v_source_provider <> lower(trim(p_target_provider)) THEN
    RAISE EXCEPTION 'cross-provider candidate requires manager-authorized handoff'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_revision_id', p_expected_active_revision_id::text, true);
  PERFORM 1
  FROM public.whatsapp_session_revision AS revision
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_expected_active_revision_id
    AND revision.provider = v_source_provider
    AND revision.status IN ('staging', 'validating', 'active')
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source whatsapp session revision is not usable'
      USING ERRCODE = '55000';
  END IF;

  v_revision_id := nextval(
    pg_get_serial_sequence('public.whatsapp_session_revision', 'revision_id')
  );
  PERFORM set_config('app.whatsapp_revision_id', v_revision_id::text, true);
  INSERT INTO public.whatsapp_session_revision (
    session_id, revision_id, provider, status, source,
    schema_version, codec_version, format, writer_generation,
    writer_epoch, capability_hash
  ) VALUES (
    p_session_id, v_revision_id, lower(trim(p_target_provider)), 'staging',
    lower(trim(p_source)), p_schema_version, p_codec_version, trim(p_format),
    p_generation, p_epoch, v_capability_hash
  );

  INSERT INTO public.whatsapp_session_handoff (
    session_id, handoff_id, source_provider, target_provider,
    source_revision_id, target_revision_id, state, next_attempt_at
  ) VALUES (
    p_session_id, v_handoff_id, v_source_provider,
    lower(trim(p_target_provider)), p_expected_active_revision_id,
    v_revision_id, 'hydrating', clock_timestamp()
  );

  UPDATE public.whatsapp_session
  SET state = 'handoff',
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND active_revision_id = p_expected_active_revision_id
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed while creating candidate'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT v_revision_id, v_handoff_id, p_expected_active_revision_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_whatsapp_session_pairing(p_session_id uuid, p_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_provider text;
  v_device_fingerprint bytea;
  v_device_jid text;
  v_checksum text;
BEGIN
  PERFORM public.begin_whatsapp_session_operation(
    p_session_id, p_revision_id, p_owner_id, p_fencing_token,
    p_generation, p_epoch, p_capability
  );

  SELECT revision.provider, device.device_fingerprint, device.jid
  INTO v_provider, v_device_fingerprint, v_device_jid
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_revision_id
    AND revision.status IN ('staging', 'validating', 'active')
    AND device.jid IS NOT NULL
    AND device.device_fingerprint IS NOT NULL
    AND (
      (
        revision.provider IN ('baileys', 'whatsmeow')
        AND device.registration_id IS NOT NULL
        AND device.noise_key IS NOT NULL
        AND device.identity_key IS NOT NULL
        AND device.signed_pre_key IS NOT NULL
        AND device.signed_pre_key_sig IS NOT NULL
      )
      OR (
        revision.provider = 'wwebjs'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_artifact AS artifact
          WHERE artifact.session_id = revision.session_id
            AND artifact.revision_id = revision.revision_id
            AND artifact.provider = 'wwebjs'
            AND artifact.status = 'ready'
        )
      )
    )
  FOR UPDATE OF revision, device;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paired whatsapp session identity is incomplete'
      USING ERRCODE = '23514';
  END IF;

  v_checksum := encode(
    public.digest(convert_to(v_device_jid, 'UTF8') || v_device_fingerprint, 'sha256'),
    'hex'
  );
  UPDATE public.whatsapp_session_revision
  SET status = 'active',
      checksum_sha256 = COALESCE(checksum_sha256, v_checksum),
      persisted_at = COALESCE(persisted_at, clock_timestamp()),
      validated_at = COALESCE(validated_at, clock_timestamp()),
      promoted_at = COALESCE(promoted_at, clock_timestamp())
  WHERE session_id = p_session_id
    AND revision_id = p_revision_id;

  UPDATE public.whatsapp_session
  SET state = 'ready',
      active_device_fingerprint = v_device_fingerprint,
      last_persisted_at = clock_timestamp(),
      last_error_at = NULL,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND active_revision_id = p_revision_id
    AND provider = v_provider
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed during pairing finalization'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.promote_whatsapp_session_revision(p_session_id uuid, p_expected_active_revision_id bigint, p_target_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text, p_expected_jid text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_provider text;
  v_target_provider text;
  v_lifecycle_operation_id uuid;
  v_source_worker_type uuid;
  v_target_worker_type uuid;
  v_device_fingerprint bytea;
  v_device_jid text;
  v_source_fingerprint bytea;
  v_source_jid text;
BEGIN
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  -- Worker remains source-authoritative until this transaction commits. Lock
  -- it before the session graph to keep the control-plane lock order stable.
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for promotion'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_operation(
    p_session_id,
    p_target_revision_id,
    p_owner_id,
    p_fencing_token,
    p_generation,
    p_epoch,
    p_capability
  );

  -- Serialize the exact handoff before touching either revision. This closes
  -- the race where another connection could fail/rollback the handoff after
  -- the lease check but before the header promotion.
  -- Idempotent retry after a committed promotion whose response was lost.
  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session AS session
    JOIN public.whatsapp_session_handoff AS handoff
      ON handoff.session_id = session.session_id
     AND handoff.source_revision_id = p_expected_active_revision_id
     AND handoff.target_revision_id = p_target_revision_id
    JOIN public.worker AS worker
      ON worker.worker_id = session.session_id
    WHERE session.session_id = p_session_id
      AND session.active_revision_id = p_target_revision_id
      AND session.provider = handoff.target_provider
      AND session.state = 'ready'
      AND handoff.state = 'completed'
      AND worker.worker_type_id = CASE handoff.target_provider
        WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
        WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
        WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      END
  ) THEN
    RETURN true;
  END IF;

  SELECT handoff.source_provider, target_revision.provider,
    handoff.lifecycle_operation_id
  INTO v_source_provider, v_target_provider, v_lifecycle_operation_id
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_handoff AS handoff
    ON handoff.session_id = session.session_id
   AND handoff.source_revision_id = p_expected_active_revision_id
   AND handoff.target_revision_id = p_target_revision_id
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = handoff.session_id
   AND source_revision.revision_id = handoff.source_revision_id
  JOIN public.whatsapp_session_revision AS target_revision
    ON target_revision.session_id = handoff.session_id
   AND target_revision.revision_id = handoff.target_revision_id
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_expected_active_revision_id
    AND session.provider = handoff.source_provider
    AND source_revision.provider = handoff.source_provider
    AND target_revision.provider = handoff.target_provider
    AND handoff.state IN (
      'transforming', 'hydrating', 'validating', 'promoting'
    )
  FOR UPDATE OF handoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session promotion handoff changed'
      USING ERRCODE = '40001';
  END IF;

  v_source_worker_type := CASE v_source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;
  v_target_worker_type := CASE v_target_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;

  SELECT revision.provider, device.device_fingerprint, device.jid
  INTO v_target_provider, v_device_fingerprint, v_device_jid
  FROM public.whatsapp_session_revision AS revision
  JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_target_revision_id
    AND revision.provider = v_target_provider
    AND revision.status IN ('staging', 'validating')
    AND revision.checksum_sha256 IS NOT NULL
    AND device.jid IS NOT NULL
    AND device.device_fingerprint IS NOT NULL
    AND (
      (
        revision.provider IN ('baileys', 'whatsmeow')
        AND device.registration_id IS NOT NULL
        AND device.noise_key IS NOT NULL
        AND device.identity_key IS NOT NULL
        AND device.signed_pre_key IS NOT NULL
        AND device.signed_pre_key_sig IS NOT NULL
      )
      OR (
        revision.provider = 'wwebjs'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_artifact AS artifact
          WHERE artifact.session_id = revision.session_id
            AND artifact.revision_id = revision.revision_id
            AND artifact.provider = 'wwebjs'
            AND artifact.status = 'ready'
        )
      )
    )
  FOR UPDATE OF revision, device;

  IF NOT FOUND OR (
    p_expected_jid IS NOT NULL
    AND public.normalize_whatsapp_companion_jid(v_device_jid)
      <> public.normalize_whatsapp_companion_jid(p_expected_jid)
  ) THEN
    RAISE EXCEPTION 'candidate whatsapp session identity is incomplete or mismatched'
      USING ERRCODE = '23514';
  END IF;

  SELECT source_device.device_fingerprint, source_device.jid
  INTO v_source_fingerprint, v_source_jid
  FROM public.whatsapp_session AS session
  JOIN public.whatsapp_session_revision AS source_revision
    ON source_revision.session_id = session.session_id
   AND source_revision.revision_id = session.active_revision_id
  JOIN public.whatsapp_device AS source_device
    ON source_device.session_id = source_revision.session_id
   AND source_device.revision_id = source_revision.revision_id
  WHERE session.session_id = p_session_id
    AND session.active_revision_id = p_expected_active_revision_id
    AND source_revision.status IN ('staging', 'validating', 'active')
    AND source_device.jid IS NOT NULL
    AND source_device.device_fingerprint IS NOT NULL
  FOR SHARE OF source_revision, source_device;
  IF NOT FOUND
    OR public.normalize_whatsapp_companion_jid(v_device_jid)
      IS DISTINCT FROM public.normalize_whatsapp_companion_jid(v_source_jid)
    OR v_device_fingerprint IS DISTINCT FROM v_source_fingerprint
  THEN
    RAISE EXCEPTION 'candidate whatsapp session changed companion identity'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = 'retired', retired_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_expected_active_revision_id
    AND status IN ('staging', 'validating', 'active');

  IF p_expected_active_revision_id IS NOT NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'active whatsapp session revision changed during promotion'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = 'active',
      validated_at = COALESCE(validated_at, clock_timestamp()),
      promoted_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_target_revision_id
    AND status IN ('staging', 'validating');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate whatsapp session revision is no longer promotable'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session
  SET provider = v_target_provider,
      state = 'ready',
      previous_revision_id = p_expected_active_revision_id,
      active_revision_id = p_target_revision_id,
      active_device_fingerprint = v_device_fingerprint,
      last_persisted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND active_revision_id IS NOT DISTINCT FROM p_expected_active_revision_id
    AND generation = p_generation
    AND epoch = p_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session header changed during promotion'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.worker AS worker
  SET worker_type_id = v_target_worker_type,
      updated_at = clock_timestamp()
  WHERE worker.worker_id = p_session_id
    AND worker.worker_type_id = v_source_worker_type
    AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    AND worker.lifecycle_operation_id = v_lifecycle_operation_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker provider changed during whatsapp session promotion'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'completed', updated_at = clock_timestamp(), completed_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND source_revision_id = p_expected_active_revision_id
    AND target_revision_id = p_target_revision_id
    AND source_provider = (
      SELECT source_revision.provider
      FROM public.whatsapp_session_revision AS source_revision
      WHERE source_revision.session_id = p_session_id
        AND source_revision.revision_id = p_expected_active_revision_id
    )
    AND target_provider = v_target_provider
    AND state IN ('transforming', 'hydrating', 'validating', 'promoting');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session handoff changed before completion'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rollback_whatsapp_session_revision(p_session_id uuid, p_candidate_revision_id bigint, p_previous_revision_id bigint, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_provider text;
  v_target_provider text;
  v_lifecycle_operation_id uuid;
  v_source_worker_type uuid;
  v_target_worker_type uuid;
  v_previous_provider text;
  v_previous_status text;
  v_previous_fingerprint bytea;
  v_previous_jid text;
BEGIN
  IF p_candidate_revision_id IS NULL OR p_previous_revision_id IS NULL
    OR p_candidate_revision_id = p_previous_revision_id
  THEN
    RAISE EXCEPTION 'invalid whatsapp session rollback revisions'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp worker is unavailable for rollback'
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.begin_whatsapp_session_operation(
    p_session_id,
    p_candidate_revision_id,
    p_owner_id,
    p_fencing_token,
    p_generation,
    p_epoch,
    p_capability
  );

  SELECT handoff.source_provider, handoff.target_provider,
    handoff.lifecycle_operation_id
  INTO v_source_provider, v_target_provider, v_lifecycle_operation_id
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.source_revision_id = p_previous_revision_id
    AND handoff.target_revision_id = p_candidate_revision_id
    AND handoff.state IN (
      'requested', 'draining', 'transforming', 'hydrating',
      'validating', 'promoting', 'completed'
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session rollback association is invalid'
      USING ERRCODE = '55000';
  END IF;

  v_source_worker_type := CASE v_source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;
  v_target_worker_type := CASE v_target_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;

  UPDATE public.whatsapp_session_revision
  SET status = 'failed',
      error_code = COALESCE(error_code, 'handoff_rolled_back'),
      retired_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND revision_id = p_candidate_revision_id
    AND status IN ('staging', 'validating', 'active');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate whatsapp session revision is not rollbackable'
      USING ERRCODE = '40001';
  END IF;

  PERFORM set_config('app.whatsapp_revision_id', p_previous_revision_id::text, true);
  SELECT revision.provider, revision.status, device.device_fingerprint, device.jid
  INTO v_previous_provider, v_previous_status, v_previous_fingerprint, v_previous_jid
  FROM public.whatsapp_session_revision AS revision
  LEFT JOIN public.whatsapp_device AS device
    ON device.session_id = revision.session_id
   AND device.revision_id = revision.revision_id
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_previous_revision_id
    AND revision.status IN ('staging', 'validating', 'active', 'retired')
  FOR UPDATE OF revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'previous whatsapp session revision is unavailable'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.whatsapp_session_revision
  SET status = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN 'active'
        WHEN v_previous_status = 'retired' THEN 'validating'
        ELSE v_previous_status
      END,
      error_code = NULL,
      retired_at = NULL,
      promoted_at = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN COALESCE(promoted_at, clock_timestamp())
        ELSE promoted_at
      END
  WHERE session_id = p_session_id
    AND revision_id = p_previous_revision_id;

  UPDATE public.whatsapp_session
  SET provider = v_previous_provider,
      state = CASE
        WHEN v_previous_jid IS NOT NULL AND v_previous_fingerprint IS NOT NULL
          THEN 'ready'
        ELSE 'preparing'
      END,
      active_revision_id = p_previous_revision_id,
      previous_revision_id = NULL,
      active_device_fingerprint = v_previous_fingerprint,
      last_error_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND generation = p_generation
    AND epoch = p_epoch
    AND (
      active_revision_id = p_candidate_revision_id
      OR (
        active_revision_id = p_previous_revision_id
        AND previous_revision_id IS DISTINCT FROM p_candidate_revision_id
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed during rollback'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.worker AS worker
  SET worker_type_id = v_source_worker_type,
      updated_at = clock_timestamp()
  WHERE worker.worker_id = p_session_id
    AND worker.worker_type_id IN (v_source_worker_type, v_target_worker_type)
    AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    AND worker.lifecycle_operation_id = v_lifecycle_operation_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker lifecycle changed during whatsapp session rollback'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_session_handoff
  SET state = 'failed',
      error_code = COALESCE(error_code, 'rolled_back'),
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND source_revision_id = p_previous_revision_id
    AND target_revision_id = p_candidate_revision_id
    AND state IN (
      'requested', 'draining', 'transforming', 'hydrating',
      'validating', 'promoting', 'completed'
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session rollback handoff changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_whatsapp_session(p_session_id uuid, p_owner_id uuid, p_fencing_token bigint, p_generation integer, p_epoch uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_capability_hash text;
BEGIN
  IF p_session_id IS NULL OR p_owner_id IS NULL OR p_epoch IS NULL
    OR p_fencing_token <= 0 OR p_generation <= 0
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
  THEN
    RAISE EXCEPTION 'invalid whatsapp session clear arguments'
      USING ERRCODE = '22023';
  END IF;
  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);
  PERFORM 1
  FROM public.whatsapp_session_lease AS lease
  JOIN public.whatsapp_session AS session
    ON session.session_id = lease.session_id
  WHERE lease.session_id = p_session_id
    AND lease.owner_id = p_owner_id
    AND lease.fencing_token = p_fencing_token
    AND lease.generation = p_generation
    AND lease.epoch = p_epoch
    AND lease.expires_at > clock_timestamp()
    AND lease.provider = session.provider
    AND session.generation = p_generation
    AND session.epoch = p_epoch
    AND session.capability_hash = v_capability_hash
    AND session.state <> 'handoff'
  FOR SHARE OF lease
  FOR UPDATE OF session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp session clear'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.whatsapp_session_revision
  WHERE session_id = p_session_id
  FOR UPDATE;

  UPDATE public.whatsapp_session
  SET state = 'empty',
      active_revision_id = NULL,
      previous_revision_id = NULL,
      active_device_fingerprint = NULL,
      last_persisted_at = NULL,
      last_error_at = NULL,
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND generation = p_generation
    AND epoch = p_epoch;

  DELETE FROM public.whatsapp_session_handoff
  WHERE session_id = p_session_id;
  DELETE FROM public.whatsapp_session_revision
  WHERE session_id = p_session_id;
  DELETE FROM public.whatsapp_artifact_blob
  WHERE session_id = p_session_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_whatsapp_provider_handoff(p_session_id uuid, p_account_id uuid, p_source_provider text, p_target_provider text, p_lifecycle_operation_id uuid)
 RETURNS TABLE(handoff_id uuid, target_revision_id bigint, source_revision_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_worker_type uuid;
  v_target_worker_type uuid;
  v_session public.whatsapp_session%ROWTYPE;
  v_source_revision public.whatsapp_session_revision%ROWTYPE;
  v_handoff_id uuid;
  v_target_revision_id bigint;
BEGIN
  p_source_provider := lower(trim(p_source_provider));
  p_target_provider := lower(trim(p_target_provider));

  IF p_session_id IS NULL OR p_account_id IS NULL
    OR p_lifecycle_operation_id IS NULL
    OR p_source_provider NOT IN ('baileys', 'wwebjs', 'whatsmeow')
    OR p_target_provider NOT IN ('baileys', 'wwebjs', 'whatsmeow')
    OR p_source_provider = p_target_provider
  THEN
    RAISE EXCEPTION 'invalid whatsapp provider handoff request arguments'
      USING ERRCODE = '22023';
  END IF;

  v_source_worker_type := CASE p_source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;
  v_target_worker_type := CASE p_target_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;
  -- Lock order is worker -> session -> revision -> artifact.
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.account_id = p_account_id
    -- The source remains the authoritative worker type until candidate
    -- promotion. The target identity lives only in this handoff row.
    AND worker.worker_type_id = v_source_worker_type
    AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    AND worker.lifecycle_operation_id = p_lifecycle_operation_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker lifecycle does not authorize whatsapp provider handoff'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);

  SELECT handoff.handoff_id, handoff.target_revision_id,
    handoff.source_revision_id
  INTO v_handoff_id, v_target_revision_id, source_revision_id
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.lifecycle_operation_id = p_lifecycle_operation_id;
  IF FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.whatsapp_session_handoff AS handoff
      WHERE handoff.session_id = p_session_id
        AND handoff.handoff_id = v_handoff_id
        AND handoff.source_provider = p_source_provider
        AND handoff.target_provider = p_target_provider
    ) THEN
      RETURN QUERY SELECT v_handoff_id, v_target_revision_id, source_revision_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'lifecycle operation is bound to a different whatsapp handoff'
      USING ERRCODE = '55000';
  END IF;

  SELECT session.*
  INTO v_session
  FROM public.whatsapp_session AS session
  WHERE session.session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.worker_runtime AS runtime
      WHERE runtime.worker_id = p_session_id
    ) THEN
      -- A NULL container_id is still a durable generation reservation and can
      -- be in the create -> Docker -> claim crash window. Never reinterpret it
      -- as an empty channel or switch the worker type underneath that source.
      RAISE EXCEPTION 'empty whatsapp provider switch requires an absent runtime reservation'
        USING ERRCODE = '55000';
    END IF;
    -- A channel that has never opened a PostgreSQL session has no source
    -- projection to drain or promote. Switch that empty identity by CAS in
    -- this same transaction; the target runtime will create its first header.
    UPDATE public.worker AS worker
    SET worker_type_id = v_target_worker_type,
        number = NULL,
        connection_date = NULL,
        updated_at = clock_timestamp()
    WHERE worker.worker_id = p_session_id
      AND worker.account_id = p_account_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
      AND worker.lifecycle_operation_id = p_lifecycle_operation_id
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'empty whatsapp worker changed before provider switch'
        USING ERRCODE = '40001';
    END IF;
    RETURN;
  END IF;

  IF v_session.provider = p_target_provider
    AND v_session.state <> 'handoff'
  THEN
    RETURN;
  END IF;

  IF v_session.provider <> p_source_provider THEN
    RAISE EXCEPTION 'whatsapp session provider changed before handoff request'
      USING ERRCODE = '40001';
  END IF;

  IF v_session.state IN ('empty', 'preparing') THEN
    IF v_session.epoch IS NULL OR v_session.capability_hash IS NULL THEN
      RAISE EXCEPTION 'empty whatsapp session runtime fence is not initialized'
        USING ERRCODE = '55000';
    END IF;

    IF v_session.active_revision_id IS NOT NULL THEN
      SELECT revision.*
      INTO v_source_revision
      FROM public.whatsapp_session_revision AS revision
      WHERE revision.session_id = p_session_id
        AND revision.revision_id = v_session.active_revision_id
        AND revision.provider = p_source_provider
        AND revision.status IN ('staging', 'validating')
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'empty whatsapp source revision is unavailable'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      v_source_revision.revision_id := nextval(
        pg_get_serial_sequence('public.whatsapp_session_revision', 'revision_id')
      );
      INSERT INTO public.whatsapp_session_revision (
        session_id, revision_id, provider, status, source,
        schema_version, codec_version, format, writer_generation,
        writer_epoch, capability_hash
      ) VALUES (
        p_session_id, v_source_revision.revision_id, p_source_provider,
        'staging', 'checkpoint', 16, 1, 'whatsapp-canonical-v1',
        v_session.generation, v_session.epoch, v_session.capability_hash
      );
    END IF;

    v_target_revision_id := nextval(
      pg_get_serial_sequence('public.whatsapp_session_revision', 'revision_id')
    );
    v_handoff_id := gen_random_uuid();
    INSERT INTO public.whatsapp_session_revision (
      session_id, revision_id, provider, status, source,
      schema_version, codec_version, format, writer_generation,
      writer_epoch, capability_hash
    ) VALUES (
      p_session_id, v_target_revision_id, p_target_provider, 'staging',
      'handoff', 16, 1, 'whatsapp-canonical-v1',
      v_session.generation, v_session.epoch, v_session.capability_hash
    );
    INSERT INTO public.whatsapp_session_handoff (
      session_id, handoff_id, lifecycle_operation_id,
      source_provider, target_provider, source_revision_id,
      target_revision_id, state, next_attempt_at
    ) VALUES (
      p_session_id, v_handoff_id, p_lifecycle_operation_id,
      p_source_provider, p_target_provider, v_source_revision.revision_id,
      v_target_revision_id, 'requested', clock_timestamp()
    );
    UPDATE public.whatsapp_session
    SET state = 'handoff',
        active_revision_id = v_source_revision.revision_id,
        updated_at = clock_timestamp()
    WHERE session_id = p_session_id
      AND provider = p_source_provider
      AND state IN ('empty', 'preparing')
      AND active_revision_id IS NOT DISTINCT FROM v_session.active_revision_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'empty whatsapp session changed while requesting handoff'
        USING ERRCODE = '40001';
    END IF;
    RETURN QUERY SELECT v_handoff_id, v_target_revision_id,
      v_source_revision.revision_id;
    RETURN;
  END IF;

  IF v_session.state <> 'ready'
    OR v_session.active_revision_id IS NULL
    OR v_session.epoch IS NULL
    OR v_session.capability_hash IS NULL
  THEN
    RAISE EXCEPTION 'whatsapp session is not ready for provider handoff'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.whatsapp_session_handoff AS handoff
    WHERE handoff.session_id = p_session_id
      AND handoff.state IN (
        'requested', 'draining', 'transforming', 'hydrating',
        'validating', 'promoting'
      )
  ) THEN
    RAISE EXCEPTION 'another whatsapp provider handoff is already active'
      USING ERRCODE = '55000';
  END IF;

  SELECT revision.*
  INTO v_source_revision
  FROM public.whatsapp_session_revision AS revision
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = v_session.active_revision_id
    AND revision.provider = p_source_provider
    AND revision.status = 'active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active whatsapp source revision is unavailable'
      USING ERRCODE = '55000';
  END IF;

  v_target_revision_id := nextval(
    pg_get_serial_sequence('public.whatsapp_session_revision', 'revision_id')
  );
  v_handoff_id := gen_random_uuid();

  INSERT INTO public.whatsapp_session_revision (
    session_id, revision_id, provider, status, source,
    schema_version, codec_version, format, writer_generation,
    writer_epoch, capability_hash
  ) VALUES (
    p_session_id, v_target_revision_id, p_target_provider, 'staging',
    'handoff', 16, 1, 'whatsapp-canonical-v1',
    v_session.generation, v_session.epoch, v_session.capability_hash
  );

  INSERT INTO public.whatsapp_session_handoff (
    session_id, handoff_id, lifecycle_operation_id,
    source_provider, target_provider, source_revision_id,
    target_revision_id, state, next_attempt_at
  ) VALUES (
    p_session_id, v_handoff_id, p_lifecycle_operation_id,
    p_source_provider, p_target_provider, v_session.active_revision_id,
    v_target_revision_id, 'requested', clock_timestamp()
  );

  UPDATE public.whatsapp_session
  SET state = 'handoff', updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND provider = p_source_provider
    AND active_revision_id = v_session.active_revision_id
    AND state = 'ready';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed while requesting handoff'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY
  SELECT v_handoff_id, v_target_revision_id, v_session.active_revision_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.acknowledge_whatsapp_handoff_source_drained(
  p_session_id uuid,
  p_account_id uuid,
  p_lifecycle_operation_id uuid,
  p_handoff_id uuid,
  p_source_provider text,
  p_source_revision_id bigint,
  p_runtime_generation integer,
  p_checkpoint_checksum_sha256 text,
  p_checkpoint_size_bytes bigint,
  p_checkpoint_record_count bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_source_worker_type uuid;
  v_target_worker_type uuid;
  v_target_provider text;
  v_target_revision_id bigint;
  v_source_revision_status text;
  v_handoff_state text;
  v_stored_checksum text;
  v_stored_size_bytes bigint;
  v_stored_record_count bigint;
  v_source_drained_at timestamptz;
BEGIN
  p_source_provider := lower(trim(p_source_provider));
  p_checkpoint_checksum_sha256 := lower(trim(p_checkpoint_checksum_sha256));
  IF p_session_id IS NULL OR p_account_id IS NULL
    OR p_lifecycle_operation_id IS NULL OR p_handoff_id IS NULL
    OR p_source_revision_id IS NULL OR p_source_revision_id <= 0
    OR p_runtime_generation IS NULL OR p_runtime_generation <= 0
    OR p_source_provider NOT IN ('baileys', 'wwebjs', 'whatsmeow')
    OR p_checkpoint_checksum_sha256 !~ '^[0-9a-f]{64}$'
    OR p_checkpoint_size_bytes IS NULL OR p_checkpoint_size_bytes < 0
    OR p_checkpoint_record_count IS NULL OR p_checkpoint_record_count < 0
  THEN
    RAISE EXCEPTION 'invalid whatsapp handoff source drain acknowledgement'
      USING ERRCODE = '22023';
  END IF;

  v_source_worker_type := CASE p_source_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
  END;
  PERFORM set_config('app.whatsapp_session_id', p_session_id::text, true);

  -- Control-plane lock order: worker -> runtime -> lease -> session ->
  -- revision -> handoff. begin_whatsapp_session_operation holds shared lease,
  -- session and revision locks, so this waits for every already-authorized
  -- source write before it advances the durable handoff phase.
  PERFORM 1
  FROM public.worker AS worker
  WHERE worker.worker_id = p_session_id
    AND worker.account_id = p_account_id
    AND worker.worker_type_id = v_source_worker_type
    AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    AND worker.lifecycle_operation_id = p_lifecycle_operation_id
    AND worker.session_storage = 'postgres'
    AND worker.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker lifecycle does not authorize source drain acknowledgement'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.worker_runtime AS runtime
  WHERE runtime.worker_id = p_session_id
    AND runtime.runtime_generation = p_runtime_generation
    AND runtime.session_storage = 'postgres'
    AND runtime.session_volume_name IS NULL
    AND runtime.source_provider = p_source_provider
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source runtime changed before drain acknowledgement'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.whatsapp_session_lease AS lease
  WHERE lease.session_id = p_session_id
  FOR UPDATE;
  IF NOT FOUND
    OR EXISTS (
      SELECT 1
      FROM public.whatsapp_session_lease AS lease
      WHERE lease.session_id = p_session_id
        AND (
          lease.owner_id IS NOT NULL
          OR lease.provider IS NOT NULL
          OR lease.epoch IS NOT NULL
          OR lease.acquired_at IS NOT NULL
          OR lease.heartbeat_at IS NOT NULL
          OR lease.expires_at IS NOT NULL
        )
    )
  THEN
    -- Expiration is deliberately insufficient. Only the provider's explicit
    -- release clears every ownership field and proves graceful shutdown.
    RAISE EXCEPTION 'source whatsapp lease was not explicitly released'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.whatsapp_session AS session
  WHERE session.session_id = p_session_id
    AND session.provider = p_source_provider
    AND session.state = 'handoff'
    AND session.active_revision_id = p_source_revision_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source whatsapp session changed before drain acknowledgement'
      USING ERRCODE = '40001';
  END IF;

  SELECT revision.status
  INTO v_source_revision_status
  FROM public.whatsapp_session_revision AS revision
  WHERE revision.session_id = p_session_id
    AND revision.revision_id = p_source_revision_id
    AND revision.provider = p_source_provider
    AND revision.status IN ('staging', 'validating', 'active')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source whatsapp revision changed before drain acknowledgement'
      USING ERRCODE = '40001';
  END IF;

  SELECT handoff.state,
    handoff.target_provider,
    handoff.target_revision_id,
    handoff.source_checkpoint_checksum_sha256,
    handoff.source_checkpoint_size_bytes,
    handoff.source_checkpoint_record_count,
    handoff.source_drained_at
  INTO v_handoff_state, v_target_provider, v_target_revision_id,
    v_stored_checksum, v_stored_size_bytes, v_stored_record_count,
    v_source_drained_at
  FROM public.whatsapp_session_handoff AS handoff
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = p_handoff_id
    AND handoff.lifecycle_operation_id = p_lifecycle_operation_id
    AND handoff.source_provider = p_source_provider
    AND handoff.source_revision_id = p_source_revision_id
  FOR UPDATE;
  IF NOT FOUND OR v_handoff_state IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'whatsapp handoff changed before source drain acknowledgement'
      USING ERRCODE = '40001';
  END IF;

  IF v_handoff_state IN ('transforming', 'hydrating', 'validating', 'promoting') THEN
    -- A previous call committed and its response was lost. The phase itself
    -- is the durable proof that the explicit-release checks already passed.
    IF v_source_drained_at IS NULL
      OR v_stored_checksum IS DISTINCT FROM p_checkpoint_checksum_sha256
      OR v_stored_size_bytes IS DISTINCT FROM p_checkpoint_size_bytes
      OR v_stored_record_count IS DISTINCT FROM p_checkpoint_record_count
    THEN
      RAISE EXCEPTION 'stored source checkpoint proof does not match acknowledgement'
        USING ERRCODE = '23514';
    END IF;
    RETURN true;
  END IF;
  IF v_handoff_state NOT IN ('requested', 'draining') THEN
    RAISE EXCEPTION 'whatsapp handoff is not drainable'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.whatsapp_session_handoff AS handoff
  SET state = 'transforming',
      updated_at = clock_timestamp(),
      error_code = NULL,
      source_checkpoint_checksum_sha256 = p_checkpoint_checksum_sha256,
      source_checkpoint_size_bytes = p_checkpoint_size_bytes,
      source_checkpoint_record_count = p_checkpoint_record_count,
      source_drained_at = clock_timestamp()
  WHERE handoff.session_id = p_session_id
    AND handoff.handoff_id = p_handoff_id
    AND handoff.lifecycle_operation_id = p_lifecycle_operation_id
    AND handoff.source_revision_id = p_source_revision_id
    AND handoff.state IN ('requested', 'draining');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp handoff changed during source drain acknowledgement'
      USING ERRCODE = '40001';
  END IF;

  IF v_source_revision_status <> 'active' THEN
    -- An empty/preparing channel has no validated companion to convert. The
    -- source RPC still had to pause writes, checkpoint, disconnect and release
    -- its lease. Complete the provider identity switch atomically only now.
    v_target_worker_type := CASE v_target_provider
      WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
      WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
      WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
    END;

    UPDATE public.whatsapp_session
    SET provider = v_target_provider,
        state = 'empty',
        active_revision_id = NULL,
        previous_revision_id = NULL,
        active_device_fingerprint = NULL,
        last_persisted_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE session_id = p_session_id
      AND provider = p_source_provider
      AND state = 'handoff'
      AND active_revision_id = p_source_revision_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'empty whatsapp session changed during drain acknowledgement'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.whatsapp_session_revision
    SET status = 'failed',
        error_code = COALESCE(error_code, 'empty_provider_switch'),
        retired_at = clock_timestamp()
    WHERE session_id = p_session_id
      AND revision_id IN (p_source_revision_id, v_target_revision_id)
      AND status IN ('staging', 'validating');

    UPDATE public.worker AS worker
    SET worker_type_id = v_target_worker_type,
        number = NULL,
        connection_date = NULL,
        updated_at = clock_timestamp()
    WHERE worker.worker_id = p_session_id
      AND worker.account_id = p_account_id
      AND worker.worker_type_id = v_source_worker_type
      AND worker.worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
      AND worker.lifecycle_operation_id = p_lifecycle_operation_id
      AND worker.session_storage = 'postgres'
      AND worker.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'empty whatsapp worker changed during provider switch'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.whatsapp_session_handoff
    SET state = 'completed',
        updated_at = clock_timestamp(),
        completed_at = clock_timestamp()
    WHERE session_id = p_session_id
      AND handoff_id = p_handoff_id
      AND state = 'transforming';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'empty whatsapp handoff changed during completion'
        USING ERRCODE = '40001';
    END IF;
    RETURN true;
  END IF;

  UPDATE public.whatsapp_session
  SET last_persisted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE session_id = p_session_id
    AND provider = p_source_provider
    AND state = 'handoff'
    AND active_revision_id = p_source_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp session changed during source drain acknowledgement'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence(p_worker_id uuid, p_account_id uuid, p_provider text, p_generation integer, p_writer_epoch uuid, p_capability text, p_container_id text, p_connection_epoch uuid)
 RETURNS TABLE(activated boolean, already_active boolean, connection_sequence bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_expected_worker_type uuid;
  v_capability_hash text;
  v_worker_storage character varying(20);
  v_worker_status_id uuid;
  v_worker_container_id character varying(100);
  v_lifecycle_operation_id uuid;
  v_runtime public.worker_runtime%ROWTYPE;
  v_header_provider character varying(20);
  v_header_generation integer;
  v_header_writer_epoch uuid;
  v_header_capability_hash character varying(64);
  v_header_state character varying(20);
  v_header_allows_provider boolean := true;
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
  PERFORM set_config('app.whatsapp_session_id', p_worker_id::text, true);

  -- Global lock order is worker first, runtime second, warm lineage third
  -- (when present), and session header last.
  SELECT w."session_storage", w."worker_status_id", w."container_id",
    w."lifecycle_operation_id"
  INTO v_worker_storage, v_worker_status_id, v_worker_container_id,
    v_lifecycle_operation_id
  FROM public."worker" AS w
  WHERE w."worker_id" = p_worker_id
    AND w."account_id" = p_account_id
    AND (
      w."worker_type_id" = v_expected_worker_type
      OR (
        w."session_storage" = 'postgres'
        AND EXISTS (
          SELECT 1
          FROM public."whatsapp_session_handoff" AS target_handoff
          WHERE target_handoff."session_id" = w."worker_id"
            AND target_handoff."lifecycle_operation_id" = w."lifecycle_operation_id"
            AND target_handoff."target_provider" = lower(trim(p_provider))
            AND w."worker_type_id" = CASE target_handoff."source_provider"
              WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
              WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
              WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
            END
            AND target_handoff."state" IN (
              'transforming', 'hydrating', 'validating', 'promoting'
            )
        )
      )
    )
    AND w."deleted_at" IS NULL
    AND w."worker_status_id" NOT IN (
      '019a930d-c6f6-766d-9c84-437433031776'::uuid,
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

  IF v_worker_status_id = '019a930d-c6f6-766d-9c84-46093814d8e0'::uuid
    AND (
      v_lifecycle_operation_id IS NULL
      OR v_runtime."container_id" IS NOT DISTINCT FROM v_worker_container_id
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
    SELECT session."provider", session."generation",
      session."epoch", session."capability_hash", session."state"
    INTO v_header_provider, v_header_generation, v_header_writer_epoch,
      v_header_capability_hash, v_header_state
    FROM public."whatsapp_session" AS session
    WHERE session."session_id" = p_worker_id
    FOR UPDATE;

    IF FOUND THEN
      v_header_allows_provider :=
        (
          v_header_provider = lower(trim(p_provider))
          AND (
            v_header_state <> 'handoff'
            OR EXISTS (
              SELECT 1
              FROM public."whatsapp_session_handoff" AS source_handoff
              WHERE source_handoff."session_id" = p_worker_id
                AND source_handoff."source_provider" = lower(trim(p_provider))
                AND source_handoff."state" IN ('requested', 'draining')
            )
          )
        )
        OR (
          v_header_state = 'handoff'
          AND EXISTS (
            SELECT 1
            FROM public."whatsapp_session_handoff" AS target_handoff
            WHERE target_handoff."session_id" = p_worker_id
              AND target_handoff."target_provider" = lower(trim(p_provider))
              AND target_handoff."state" IN (
                'transforming', 'hydrating', 'validating', 'promoting'
              )
          )
        );
    END IF;

    IF FOUND AND (
      NOT v_header_allows_provider
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
    INSERT INTO public."whatsapp_session" (
      "session_id", "provider", "state", "generation",
      "epoch", "capability_hash", "created_at", "updated_at"
    ) VALUES (
      p_worker_id, lower(trim(p_provider)), 'empty', p_generation,
      p_writer_epoch, v_capability_hash, clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT ("session_id") DO UPDATE
    SET "generation" = EXCLUDED."generation",
        "epoch" = EXCLUDED."epoch",
        "capability_hash" = EXCLUDED."capability_hash",
        "updated_at" = clock_timestamp()
    WHERE public."whatsapp_session"."generation" <= EXCLUDED."generation"
    RETURNING "provider", "generation", "epoch", "capability_hash"
    INTO v_header_provider, v_header_generation, v_header_writer_epoch,
      v_header_capability_hash;

    IF NOT FOUND
      OR NOT v_header_allows_provider
      OR v_header_generation <> p_generation
      OR v_header_writer_epoch IS DISTINCT FROM p_writer_epoch
      OR v_header_capability_hash IS DISTINCT FROM v_capability_hash
    THEN
      RAISE EXCEPTION 'whatsapp session header fence conflict'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public."whatsapp_session_revision" AS revision
    SET "writer_generation" = p_generation,
        "writer_epoch" = p_writer_epoch,
        "capability_hash" = v_capability_hash
    WHERE revision."session_id" = p_worker_id
      AND revision."status" IN ('staging', 'validating', 'active')
      AND (
        revision."revision_id" = (
          SELECT session."active_revision_id"
          FROM public."whatsapp_session" AS session
          WHERE session."session_id" = p_worker_id
            AND session."provider" = lower(trim(p_provider))
        )
        OR revision."revision_id" IN (
          SELECT handoff."target_revision_id"
          FROM public."whatsapp_session_handoff" AS handoff
          WHERE handoff."session_id" = p_worker_id
            AND handoff."target_provider" = lower(trim(p_provider))
            AND handoff."state" IN (
              'requested', 'draining', 'transforming', 'hydrating',
              'validating', 'promoting'
            )
        )
        OR revision."revision_id" IN (
          SELECT handoff."source_revision_id"
          FROM public."whatsapp_session_handoff" AS handoff
          WHERE handoff."session_id" = p_worker_id
            AND handoff."target_provider" = lower(trim(p_provider))
            AND handoff."state" IN (
              'requested', 'draining', 'transforming', 'hydrating',
              'validating', 'promoting'
            )
        )
      );
  END IF;

  activated := true;
  RETURN NEXT;
END;
$function$;

-- Operational worker access uses a second, transaction-bound capability
-- scope.  The session-store scope above deliberately cannot authorize reads
-- from tenant/application tables: legacy-volume workers do not own a session
-- lease, and a store lease must never become an account-wide bearer token.
--
-- begin_whatsapp_worker_operation validates the immutable runtime lineage and
-- takes SHARE locks on worker + worker_runtime.  A manager takeover that
-- rotates generation/epoch/capability therefore cannot commit in the middle
-- of an operational write.  All GUCs are SET LOCAL and the HMAC binds them to
-- this backend and transaction, which is safe with PgBouncer transaction mode.
CREATE OR REPLACE FUNCTION public.issue_whatsapp_worker_scope_signature()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_secret bytea;
  v_payload text;
BEGIN
  SELECT scope_secret.secret
  INTO STRICT v_secret
  FROM public.whatsapp_runtime_scope_secret AS scope_secret
  WHERE scope_secret.secret_id;

  v_payload := array_to_string(ARRAY[
    'worker-operation-v1',
    current_database(),
    session_user,
    pg_backend_pid()::text,
    txid_current()::text,
    COALESCE(current_setting('app.whatsapp_worker_id', true), ''),
    COALESCE(current_setting('app.whatsapp_worker_account_id', true), ''),
    COALESCE(current_setting('app.whatsapp_worker_provider', true), ''),
    COALESCE(current_setting('app.whatsapp_worker_generation', true), ''),
    COALESCE(current_setting('app.whatsapp_worker_epoch', true), ''),
    COALESCE(current_setting('app.whatsapp_worker_capability', true), ''),
    COALESCE(current_setting('app.whatsapp_worker_container_id', true), ''),
    COALESCE(current_setting('app.whatsapp_worker_session_storage', true), '')
  ], chr(31));

  PERFORM set_config(
    'app.whatsapp_worker_scope_signature',
    encode(public.hmac(convert_to(v_payload, 'UTF8'), v_secret, 'sha256'), 'hex'),
    true
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_whatsapp_worker_scope_signature() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.begin_whatsapp_worker_operation(
  p_worker_id uuid,
  p_account_id uuid,
  p_provider text,
  p_generation integer,
  p_writer_epoch uuid,
  p_capability text,
  p_container_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_provider text := lower(trim(p_provider));
  v_expected_worker_type uuid;
  v_capability_hash text;
  v_session_storage text;
BEGIN
  IF p_worker_id IS NULL OR p_account_id IS NULL
    OR p_generation IS NULL OR p_generation <= 0
    OR p_writer_epoch IS NULL
    OR p_capability IS NULL OR length(p_capability) < 32
    OR length(p_capability) > 512
    OR p_container_id IS NULL
    OR trim(p_container_id) !~ '^[0-9a-f]{12,64}$'
  THEN
    RAISE EXCEPTION 'invalid whatsapp worker operation arguments'
      USING ERRCODE = '22023';
  END IF;

  v_expected_worker_type := CASE v_provider
    WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
    WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
    WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
    ELSE NULL
  END;
  IF v_expected_worker_type IS NULL THEN
    RAISE EXCEPTION 'invalid whatsapp worker operation provider'
      USING ERRCODE = '22023';
  END IF;

  v_capability_hash := encode(public.digest(p_capability, 'sha256'), 'hex');
  -- The canonical session header is FORCE RLS. This unsigned value only lets
  -- the SECURITY DEFINER function address the requested header; the complete
  -- runtime lineage is validated before any operational signature is minted.
  PERFORM set_config('app.whatsapp_session_id', p_worker_id::text, true);

  SELECT worker.session_storage
  INTO v_session_storage
  FROM public.worker AS worker
  JOIN public.worker_runtime AS runtime
    ON runtime.worker_id = worker.worker_id
  WHERE worker.worker_id = p_worker_id
    AND worker.account_id = p_account_id
    AND (
      worker.worker_type_id = v_expected_worker_type
      OR (
        worker.session_storage = 'postgres'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS target_handoff
          WHERE target_handoff.session_id = worker.worker_id
            AND target_handoff.lifecycle_operation_id = worker.lifecycle_operation_id
            AND target_handoff.target_provider = v_provider
            AND worker.worker_type_id = CASE target_handoff.source_provider
              WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
              WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
              WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
            END
            AND target_handoff.state IN (
              'transforming', 'hydrating', 'validating', 'promoting'
            )
        )
      )
    )
    AND worker.deleted_at IS NULL
    AND runtime.runtime_generation = p_generation
    AND runtime.session_writer_epoch = p_writer_epoch
    AND runtime.runtime_capability_hash = v_capability_hash
    AND runtime.session_storage = worker.session_storage
    AND runtime.container_id IS NOT NULL
    AND (
      runtime.container_id = trim(p_container_id)
      OR runtime.container_id LIKE trim(p_container_id) || '%'
    )
    AND runtime.source_provider = v_provider
    AND runtime.connection_sequence > 0
  FOR SHARE OF worker, runtime;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized whatsapp worker operation'
      USING ERRCODE = '55000';
  END IF;

  IF v_session_storage = 'postgres' THEN
    PERFORM 1
    FROM public.whatsapp_session AS session
    WHERE session.session_id = p_worker_id
      AND session.generation = p_generation
      AND session.epoch = p_writer_epoch
      AND session.capability_hash = v_capability_hash
      AND (
        (
          session.provider = v_provider
          AND (
            session.state <> 'handoff'
            OR EXISTS (
              SELECT 1
              FROM public.whatsapp_session_handoff AS source_handoff
              WHERE source_handoff.session_id = session.session_id
                AND source_handoff.source_provider = v_provider
                AND source_handoff.state IN ('requested', 'draining')
            )
          )
        )
        OR EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS target_handoff
          WHERE target_handoff.session_id = session.session_id
            AND target_handoff.target_provider = v_provider
            AND target_handoff.state IN (
              'transforming', 'hydrating', 'validating', 'promoting'
            )
        )
      )
    FOR SHARE OF session;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stale whatsapp postgres worker operation'
        USING ERRCODE = '55000';
    END IF;
  ELSIF v_session_storage <> 'legacy_volume' THEN
    RAISE EXCEPTION 'invalid whatsapp worker session storage'
      USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.whatsapp_worker_id', p_worker_id::text, true);
  PERFORM set_config('app.whatsapp_worker_account_id', p_account_id::text, true);
  PERFORM set_config('app.whatsapp_worker_provider', v_provider, true);
  PERFORM set_config('app.whatsapp_worker_generation', p_generation::text, true);
  PERFORM set_config('app.whatsapp_worker_epoch', p_writer_epoch::text, true);
  PERFORM set_config('app.whatsapp_worker_capability', p_capability, true);
  PERFORM set_config('app.whatsapp_worker_container_id', trim(p_container_id), true);
  PERFORM set_config('app.whatsapp_worker_session_storage', v_session_storage, true);
  PERFORM public.issue_whatsapp_worker_scope_signature();
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.begin_whatsapp_worker_operation(
  uuid, uuid, text, integer, uuid, text, text
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.whatsapp_worker_operation_scope_is_valid()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH scope AS (
  SELECT
    nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid AS worker_id,
    nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid AS account_id,
    nullif(current_setting('app.whatsapp_worker_provider', true), '') AS provider,
    nullif(current_setting('app.whatsapp_worker_generation', true), '')::integer AS generation,
    nullif(current_setting('app.whatsapp_worker_epoch', true), '')::uuid AS writer_epoch,
    nullif(current_setting('app.whatsapp_worker_capability', true), '') AS capability,
    nullif(current_setting('app.whatsapp_worker_container_id', true), '') AS container_id,
    nullif(current_setting('app.whatsapp_worker_session_storage', true), '') AS session_storage,
    nullif(current_setting('app.whatsapp_worker_scope_signature', true), '') AS scope_signature
), scope_secret AS (
  SELECT secret
  FROM public.whatsapp_runtime_scope_secret
  WHERE secret_id
)
SELECT EXISTS (
  SELECT 1
  FROM scope
  CROSS JOIN scope_secret
  JOIN public.worker AS worker
    ON worker.worker_id = scope.worker_id
   AND worker.account_id = scope.account_id
  JOIN public.worker_runtime AS runtime
    ON runtime.worker_id = worker.worker_id
  LEFT JOIN public.whatsapp_session AS session
    ON scope.session_storage = 'postgres'
   AND session.session_id = scope.worker_id
  WHERE scope.worker_id IS NOT NULL
    AND scope.account_id IS NOT NULL
    AND scope.provider IN ('baileys', 'wwebjs', 'whatsmeow')
    AND scope.generation > 0
    AND scope.writer_epoch IS NOT NULL
    AND length(scope.capability) BETWEEN 32 AND 512
    AND scope.container_id ~ '^[0-9a-f]{12,64}$'
    AND scope.session_storage IN ('legacy_volume', 'postgres')
    AND (
      worker.worker_type_id = CASE scope.provider
        WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
        WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
        WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
      END
      OR (
        scope.session_storage = 'postgres'
        AND EXISTS (
          SELECT 1
          FROM public.whatsapp_session_handoff AS target_handoff
          WHERE target_handoff.session_id = worker.worker_id
            AND target_handoff.lifecycle_operation_id = worker.lifecycle_operation_id
            AND target_handoff.target_provider = scope.provider
            AND worker.worker_type_id = CASE target_handoff.source_provider
              WHEN 'baileys' THEN '019a930d-c6f6-766d-9c84-53307d4159a1'::uuid
              WHEN 'wwebjs' THEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'::uuid
              WHEN 'whatsmeow' THEN 'e80ad183-2b46-4628-9105-a036f2d28720'::uuid
            END
            AND target_handoff.state IN (
              'transforming', 'hydrating', 'validating', 'promoting'
            )
        )
      )
    )
    AND worker.deleted_at IS NULL
    AND worker.session_storage = scope.session_storage
    AND runtime.runtime_generation = scope.generation
    AND runtime.session_writer_epoch = scope.writer_epoch
    AND runtime.runtime_capability_hash =
      encode(public.digest(scope.capability, 'sha256'), 'hex')
    AND runtime.session_storage = scope.session_storage
    AND runtime.container_id IS NOT NULL
    AND (
      runtime.container_id = scope.container_id
      OR runtime.container_id LIKE scope.container_id || '%'
    )
    AND runtime.source_provider = scope.provider
    AND runtime.connection_sequence > 0
    AND (
      scope.session_storage = 'legacy_volume'
      OR (
        session.generation = scope.generation
        AND session.epoch = scope.writer_epoch
        AND session.capability_hash =
          encode(public.digest(scope.capability, 'sha256'), 'hex')
        AND (
          (
            session.provider = scope.provider
            AND (
              session.state <> 'handoff'
              OR EXISTS (
                SELECT 1
                FROM public.whatsapp_session_handoff AS source_handoff
                WHERE source_handoff.session_id = session.session_id
                  AND source_handoff.source_provider = scope.provider
                  AND source_handoff.state IN ('requested', 'draining')
              )
            )
          )
          OR EXISTS (
            SELECT 1
            FROM public.whatsapp_session_handoff AS target_handoff
            WHERE target_handoff.session_id = session.session_id
              AND target_handoff.target_provider = scope.provider
              AND target_handoff.state IN (
                'transforming', 'hydrating', 'validating', 'promoting'
              )
          )
        )
      )
    )
    AND scope.scope_signature = encode(
      public.hmac(
        convert_to(
          array_to_string(ARRAY[
            'worker-operation-v1',
            current_database(),
            session_user,
            pg_backend_pid()::text,
            txid_current()::text,
            COALESCE(scope.worker_id::text, ''),
            COALESCE(scope.account_id::text, ''),
            COALESCE(scope.provider, ''),
            COALESCE(scope.generation::text, ''),
            COALESCE(scope.writer_epoch::text, ''),
            COALESCE(scope.capability, ''),
            COALESCE(scope.container_id, ''),
            COALESCE(scope.session_storage, '')
          ], chr(31)),
          'UTF8'
        ),
        scope_secret.secret,
        'sha256'
      ),
      'hex'
    )
);
$function$;
REVOKE ALL ON FUNCTION public.whatsapp_worker_operation_scope_is_valid() FROM PUBLIC;

-- A worker may reconcile an entitlement epoch because capture must compare a
-- current revision, but it must never choose the entitlement value or touch a
-- deny-fence. Derive those fields from manager-owned plan state on every
-- runtime INSERT/UPDATE. Control-plane callers have no signed worker scope and
-- retain the existing repository semantics.
CREATE OR REPLACE FUNCTION public.enforce_whatsapp_worker_entitlement_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_scope_account_id uuid;
  v_underlying_allowed boolean;
BEGIN
  IF NOT public.whatsapp_worker_operation_scope_is_valid() THEN
    RETURN NEW;
  END IF;

  v_scope_account_id := nullif(
    current_setting('app.whatsapp_worker_account_id', true), ''
  )::uuid;
  IF NEW.account_id IS DISTINCT FROM v_scope_account_id THEN
    RAISE EXCEPTION 'worker entitlement account is outside the signed scope'
      USING ERRCODE = '42501';
  END IF;

  WITH latest_plan AS (
    SELECT assignment.plan_account_id,
      assignment.plan_id,
      assignment.last_payment_date,
      assignment.next_payment_date
    FROM public.plan_account AS assignment
    WHERE assignment.account_id = NEW.account_id
    ORDER BY assignment.updated_at DESC NULLS LAST,
      assignment.created_at DESC NULLS LAST,
      assignment.plan_account_id DESC
    LIMIT 1
  ), entitlement_state AS (
    SELECT
      COALESCE(
        account.account_id IS NOT NULL
        AND account.deleted_at IS NULL
        AND account.account_status_id <>
          '019a930d-c6f4-75ad-88ff-75403daff4e1'::uuid
        AND latest_plan.plan_account_id IS NOT NULL
        AND plan.deleted_at IS NULL
        AND latest_plan.next_payment_date > clock_timestamp(),
        false
      ) AS plan_is_active,
      EXISTS (
        SELECT 1
        FROM public.plan_items AS item
        WHERE item.plan_id = latest_plan.plan_id
          AND item.plan_product_id = NEW.plan_product_id
          AND item.quantity > 0
          AND item.deleted_at IS NULL
      ) AS granted_by_plan,
      EXISTS (
        SELECT 1
        FROM public.plan_cross_sell_account AS account_addon
        JOIN public.plan_cross_sell AS addon
          ON addon.plan_cross_sell_id = account_addon.plan_cross_sell_id
        WHERE account_addon.account_id = NEW.account_id
          AND account_addon.deleted_at IS NULL
          AND addon.deleted_at IS NULL
          AND addon.plan_product_id = NEW.plan_product_id
          AND addon.quantity > 0
          AND (
            account_addon.cancellation_date IS NULL
            OR latest_plan.last_payment_date IS NULL
            OR account_addon.cancellation_date >= latest_plan.last_payment_date
          )
      ) AS granted_by_addon
    FROM (SELECT 1) AS requested
    LEFT JOIN public.account AS account
      ON account.account_id = NEW.account_id
    LEFT JOIN latest_plan ON true
    LEFT JOIN public.plan AS plan
      ON plan.plan_id = latest_plan.plan_id
  )
  SELECT COALESCE(
    state.plan_is_active
      AND (state.granted_by_plan OR state.granted_by_addon),
    false
  )
  INTO STRICT v_underlying_allowed
  FROM entitlement_state AS state;

  IF TG_OP = 'INSERT' THEN
    NEW.revision := 1;
    NEW.allowed := v_underlying_allowed;
    NEW.deny_fence_token := NULL;
    NEW.deny_fence_created_at := NULL;
    NEW.deny_fence_released_at := NULL;
    NEW.deny_fence_operation_key := NULL;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.plan_product_id IS DISTINCT FROM OLD.plan_product_id
  THEN
    RAISE EXCEPTION 'worker cannot move an entitlement revision'
      USING ERRCODE = '42501';
  END IF;

  NEW.allowed := v_underlying_allowed;
  NEW.revision := CASE
    WHEN OLD.allowed IS DISTINCT FROM v_underlying_allowed
      THEN OLD.revision + 1
    ELSE OLD.revision
  END;
  NEW.deny_fence_token := OLD.deny_fence_token;
  NEW.deny_fence_created_at := OLD.deny_fence_created_at;
  NEW.deny_fence_released_at := OLD.deny_fence_released_at;
  NEW.deny_fence_operation_key := OLD.deny_fence_operation_key;
  NEW.updated_at := CASE
    WHEN OLD.allowed IS DISTINCT FROM v_underlying_allowed
      THEN clock_timestamp()
    ELSE OLD.updated_at
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_whatsapp_worker_entitlement_revision()
  FROM PUBLIC;

CREATE TRIGGER account_plan_product_entitlement_revision_worker_guard
BEFORE INSERT OR UPDATE
ON public.account_plan_product_entitlement_revision
FOR EACH ROW
EXECUTE FUNCTION public.enforce_whatsapp_worker_entitlement_revision();

-- Derived ownership checks keep tables without account_id safely scoped while
-- still allowing PostgreSQL to use their primary/foreign-key indexes.
CREATE OR REPLACE FUNCTION public.whatsapp_worker_scope_owns_plan(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT (SELECT public.whatsapp_worker_operation_scope_is_valid())
    AND EXISTS (
      SELECT 1 FROM public.plan_account AS assignment
      WHERE assignment.plan_id = p_plan_id
        AND assignment.account_id =
          nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid
    );
$function$;
REVOKE ALL ON FUNCTION public.whatsapp_worker_scope_owns_plan(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.whatsapp_worker_scope_owns_cross_sell(p_cross_sell_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT (SELECT public.whatsapp_worker_operation_scope_is_valid())
    AND EXISTS (
      SELECT 1 FROM public.plan_cross_sell_account AS assignment
      WHERE assignment.plan_cross_sell_id = p_cross_sell_id
        AND assignment.account_id =
          nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid
    );
$function$;
REVOKE ALL ON FUNCTION public.whatsapp_worker_scope_owns_cross_sell(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.whatsapp_worker_scope_owns_template(p_template_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT (SELECT public.whatsapp_worker_operation_scope_is_valid())
    AND EXISTS (
      SELECT 1 FROM public.message_template AS template
      WHERE template.message_template_id = p_template_id
        AND template.account_id =
          nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid
        AND (
          EXISTS (
            SELECT 1
            FROM public.message_template_channel AS association
            WHERE association.message_template_id = template.message_template_id
              AND association.channel_id =
                nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid
          )
          OR (
            NOT EXISTS (
              SELECT 1
              FROM public.message_template_channel AS association
              WHERE association.message_template_id = template.message_template_id
            )
            AND (
              template.channel_id IS NULL
              OR template.channel_id =
                nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid
            )
          )
        )
    );
$function$;
REVOKE ALL ON FUNCTION public.whatsapp_worker_scope_owns_template(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.whatsapp_worker_scope_owns_webhook(p_webhook_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT (SELECT public.whatsapp_worker_operation_scope_is_valid())
    AND EXISTS (
      SELECT 1 FROM public.outbound_webhook AS webhook
      WHERE webhook.outbound_webhook_id = p_webhook_id
        AND webhook.account_id =
          nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid
        AND webhook.channel_id =
          nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid
    );
$function$;
REVOKE ALL ON FUNCTION public.whatsapp_worker_scope_owns_webhook(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.whatsapp_worker_scope_owns_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT (SELECT public.whatsapp_worker_operation_scope_is_valid())
    AND EXISTS (
      SELECT 1 FROM public.outbound_webhook_event AS event
      WHERE event.outbound_webhook_event_id = p_event_id
        AND event.account_id =
          nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid
        AND event.routing_channel_ids <@
          ARRAY[nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid]
        AND nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid =
          ANY(event.routing_channel_ids)
    );
$function$;
REVOKE ALL ON FUNCTION public.whatsapp_worker_scope_owns_event(uuid) FROM PUBLIC;

-- Small direct operations shared by Node and Go workers remain explicit
-- SECURITY DEFINER APIs.  They never return arbitrary rows and never accept
-- account/worker identifiers without the full runtime capability lineage.
CREATE OR REPLACE FUNCTION public.read_whatsapp_worker_typing_config(
  p_worker_id uuid, p_account_id uuid, p_provider text,
  p_generation integer, p_writer_epoch uuid, p_capability text,
  p_container_id text, p_config_type_id uuid
)
RETURNS TABLE(value text, worker_config_status_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.begin_whatsapp_worker_operation(
    p_worker_id, p_account_id, p_provider, p_generation,
    p_writer_epoch, p_capability, p_container_id
  );
  RETURN QUERY
  SELECT config.value::text, config.worker_config_status_id
  FROM public.worker AS worker
  LEFT JOIN public.worker_config AS config
    ON config.worker_id = worker.worker_id
   AND config.worker_config_type_id = p_config_type_id
  WHERE worker.worker_id = p_worker_id
    AND worker.account_id = p_account_id
  LIMIT 1;
END;
$function$;
REVOKE ALL ON FUNCTION public.read_whatsapp_worker_typing_config(
  uuid, uuid, text, integer, uuid, text, text, uuid
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.read_whatsapp_worker_call_config(
  p_worker_id uuid, p_account_id uuid, p_provider text,
  p_generation integer, p_writer_epoch uuid, p_capability text,
  p_container_id text, p_reject_type_id uuid, p_message_type_id uuid
)
RETURNS TABLE(
  account_name text, worker_name text, worker_config_type_id uuid,
  worker_config_status_id uuid, value text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.begin_whatsapp_worker_operation(
    p_worker_id, p_account_id, p_provider, p_generation,
    p_writer_epoch, p_capability, p_container_id
  );
  RETURN QUERY
  SELECT account.name::text, worker.name::text,
    config.worker_config_type_id, config.worker_config_status_id,
    config.value::text
  FROM public.worker AS worker
  JOIN public.account AS account
    ON account.account_id = worker.account_id
  LEFT JOIN public.worker_config AS config
    ON config.worker_id = worker.worker_id
   AND config.worker_config_type_id IN (p_reject_type_id, p_message_type_id)
  WHERE worker.worker_id = p_worker_id
    AND worker.account_id = p_account_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.read_whatsapp_worker_call_config(
  uuid, uuid, text, integer, uuid, text, text, uuid, uuid
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.register_whatsapp_worker_s3_backup(
  p_worker_id uuid, p_account_id uuid, p_provider text,
  p_generation integer, p_writer_epoch uuid, p_capability text,
  p_container_id text, p_bucket text, p_object_key text,
  p_file_name text, p_content_type text, p_size_bytes integer,
  p_primary_attempts integer, p_backup_attempts integer,
  p_primary_error text, p_backup_error text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_upload_id uuid := public.gen_random_uuid();
BEGIN
  IF trim(COALESCE(p_bucket, '')) = ''
    OR trim(COALESCE(p_object_key, '')) = ''
    OR p_size_bytes < 0 OR p_primary_attempts < 0 OR p_backup_attempts < 0
  THEN
    RAISE EXCEPTION 'invalid whatsapp worker s3 backup arguments'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public.begin_whatsapp_worker_operation(
    p_worker_id, p_account_id, p_provider, p_generation,
    p_writer_epoch, p_capability, p_container_id
  );
  INSERT INTO public.s3_backup_upload (
    s3_backup_upload_id, account_id, bucket, object_key, file_name,
    content_type, size_bytes, primary_attempts, backup_attempts,
    primary_error, backup_error, migration_status, migration_attempts,
    created_at, updated_at
  ) VALUES (
    v_upload_id, p_account_id, p_bucket, p_object_key,
    NULLIF(p_file_name, ''), NULLIF(p_content_type, ''), p_size_bytes,
    p_primary_attempts, p_backup_attempts, NULLIF(p_primary_error, ''),
    NULLIF(p_backup_error, ''), 'pending', 0,
    clock_timestamp(), clock_timestamp()
  );
  RETURN v_upload_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.register_whatsapp_worker_s3_backup(
  uuid, uuid, text, integer, uuid, text, text, text, text, text, text,
  integer, integer, integer, text, text
) FROM PUBLIC;


-- Security-definer APIs are capability entry points, never PUBLIC APIs.
REVOKE ALL ON FUNCTION public.acquire_whatsapp_session_lease(uuid, uuid, text, integer, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acknowledge_whatsapp_handoff_source_drained(uuid, uuid, uuid, uuid, text, bigint, integer, text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence(uuid, uuid, text, integer, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_whatsapp_handoff_source_read(uuid, bigint, uuid, bigint, integer, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_whatsapp_session_operation(uuid, bigint, uuid, bigint, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_whatsapp_session(uuid, uuid, bigint, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_whatsapp_session_candidate(uuid, bigint, uuid, text, bigint, integer, uuid, text, text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_session_pairing(uuid, bigint, uuid, bigint, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hydrate_whatsapp_warm_runtime(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_whatsapp_session_revision(uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_whatsapp_session_revision(uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_whatsapp_session_lease(uuid, uuid, text, bigint, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_whatsapp_session_lease(uuid, uuid, text, bigint, integer, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_whatsapp_provider_handoff(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rollback_whatsapp_session_revision(uuid, bigint, bigint, uuid, bigint, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_worker_runtime_status(uuid, uuid, text, integer, uuid, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_worker_self_heal(uuid, uuid, text, integer, uuid, text, text, text, jsonb, text) FROM PUBLIC;

-- Policies name the group role, so create/restrict it before CREATE POLICY.
-- The idempotent provisioning block below repeats these attributes after
-- cleaning obsolete credentials and remains the source of grants.
DO $worker_scope_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'whatsapp_session_runtime'
  ) THEN
    CREATE ROLE whatsapp_session_runtime
      NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION
      NOBYPASSRLS;
  ELSE
    ALTER ROLE whatsapp_session_runtime
      NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION
      NOBYPASSRLS;
  END IF;
END;
$worker_scope_role$;

-- Tenant tables stay manager-owned (and therefore keep their existing control
-- plane behaviour), while the shared runtime role is constrained by RLS to
-- the signed worker-operation scope.  Deliberately do not FORCE these
-- policies: the table owner runs migrations/control-plane operations, whereas
-- the worker login is neither owner nor BYPASSRLS.
ALTER TABLE public.account ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.account
  TO whatsapp_session_runtime
  USING (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.worker ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.worker
  TO whatsapp_session_runtime
  USING (
    worker_id = (SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)
    AND account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.worker_runtime ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.worker_runtime
  TO whatsapp_session_runtime
  USING (
    worker_id = (SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.worker_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.worker_config
  TO whatsapp_session_runtime
  USING (
    worker_id = (SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.chatbot ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.chatbot
  TO whatsapp_session_runtime
  USING (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.message_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.message_template
  TO whatsapp_session_runtime
  USING (public.whatsapp_worker_scope_owns_template(message_template_id));

ALTER TABLE public.message_template_channel ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.message_template_channel
  TO whatsapp_session_runtime
  USING (
    channel_id = (SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)
    AND public.whatsapp_worker_scope_owns_template(message_template_id)
  );

ALTER TABLE public.plan_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.plan_account
  TO whatsapp_session_runtime
  USING (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.plan
  TO whatsapp_session_runtime
  USING (public.whatsapp_worker_scope_owns_plan(plan_id));

ALTER TABLE public.plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.plan_items
  TO whatsapp_session_runtime
  USING (public.whatsapp_worker_scope_owns_plan(plan_id));

ALTER TABLE public.plan_cross_sell_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.plan_cross_sell_account
  TO whatsapp_session_runtime
  USING (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.plan_cross_sell ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.plan_cross_sell
  TO whatsapp_session_runtime
  USING (public.whatsapp_worker_scope_owns_cross_sell(plan_cross_sell_id));

ALTER TABLE public.account_plan_product_entitlement_revision ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.account_plan_product_entitlement_revision
  TO whatsapp_session_runtime
  USING (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  )
  WITH CHECK (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.outbound_webhook ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.outbound_webhook
  TO whatsapp_session_runtime
  USING (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND channel_id = (SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.outbound_webhook_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.outbound_webhook_subscription
  TO whatsapp_session_runtime
  USING (public.whatsapp_worker_scope_owns_webhook(outbound_webhook_id));

ALTER TABLE public.outbound_webhook_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.outbound_webhook_event
  TO whatsapp_session_runtime
  USING (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND routing_channel_ids <@
      ARRAY[(SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)]
    AND (SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid) = ANY(routing_channel_ids)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  )
  WITH CHECK (
    account_id = (SELECT nullif(current_setting('app.whatsapp_worker_account_id', true), '')::uuid)
    AND routing_channel_ids <@
      ARRAY[(SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid)]
    AND (SELECT nullif(current_setting('app.whatsapp_worker_id', true), '')::uuid) = ANY(routing_channel_ids)
    AND (SELECT public.whatsapp_worker_operation_scope_is_valid())
  );

ALTER TABLE public.outbound_webhook_delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_worker_operation_scope ON public.outbound_webhook_delivery
  TO whatsapp_session_runtime
  USING (public.whatsapp_worker_scope_owns_event(outbound_webhook_event_id))
  WITH CHECK (
    public.whatsapp_worker_scope_owns_event(outbound_webhook_event_id)
    AND public.whatsapp_worker_scope_owns_webhook(outbound_webhook_id)
  );

-- Runtime workers cannot address S3 rows directly because the legacy schema
-- has no worker_id.  The capability-fenced insert function above is the only
-- worker entry point, so a sibling channel in the same account cannot reuse a
-- row identifier or mutate another fallback upload.
ALTER TABLE public.s3_backup_upload ENABLE ROW LEVEL SECURITY;

-- The worker login is provisioned separately and receives membership in this
-- NOLOGIN role. Keeping the schema ACL on a group role lets credentials rotate
-- without ever granting table ownership or BYPASSRLS to a worker process.
-- Remove the obsolete session-lock login from upgraded development clusters.
-- Failure is intentional if it still owns objects in another database: the
-- cluster must be cleaned there instead of silently retaining the credential.
DO $obsolete_role_cleanup$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'underchat_whatsmeow_lock'
  ) THEN
    EXECUTE format(
      'REVOKE CONNECT ON DATABASE %I FROM underchat_whatsmeow_lock',
      current_database()
    );
    PERFORM pg_terminate_backend(activity.pid)
    FROM pg_catalog.pg_stat_activity AS activity
    WHERE activity.usename = 'underchat_whatsmeow_lock'
      AND activity.pid <> pg_backend_pid();
    EXECUTE 'DROP OWNED BY underchat_whatsmeow_lock';
    EXECUTE 'DROP ROLE underchat_whatsmeow_lock';
  END IF;
END;
$obsolete_role_cleanup$;

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'whatsapp_session_runtime'
  ) THEN
    CREATE ROLE whatsapp_session_runtime
      NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION
      NOBYPASSRLS;
  ELSE
    ALTER ROLE whatsapp_session_runtime
      NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION
      NOBYPASSRLS;
  END IF;
END;
$role$;

-- Reset every ACL on the shared group before rebuilding the closed allowlist.
-- This also removes grants left by an older deployment of the role.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM whatsapp_session_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM whatsapp_session_runtime;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
  FROM whatsapp_session_runtime;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM whatsapp_session_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $runtime_database_acl$
BEGIN
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM whatsapp_session_runtime',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO whatsapp_session_runtime',
    current_database()
  );
END;
$runtime_database_acl$;

GRANT USAGE ON SCHEMA public TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_runtime_scope_is_valid()
  TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_artifact_is_visible(uuid, uuid)
  TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_artifact_blob_is_visible(uuid, text)
  TO whatsapp_session_runtime;
REVOKE ALL ON TABLE public.whatsapp_session_lease
  FROM whatsapp_session_runtime;
REVOKE ALL ON TABLE public.whatsapp_session_gc_queue
  FROM whatsapp_session_runtime;
GRANT SELECT ON TABLE public.whatsapp_store_version
  TO whatsapp_session_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.whatsapp_device,
  public.whatsapp_app_state_version,
  public.whatsapp_app_state_mutation_macs,
  public.whatsapp_app_state_sync_keys,
  public.whatsapp_artifact,
  public.whatsapp_artifact_blob,
  public.whatsapp_artifact_chunk,
  public.whatsapp_chat_settings,
  public.whatsapp_contacts,
  public.whatsapp_event_buffer,
  public.whatsapp_identity_keys,
  public.whatsapp_lid_map,
  public.whatsapp_message_secrets,
  public.whatsapp_nct_salt,
  public.whatsapp_pre_keys,
  public.whatsapp_privacy_tokens,
  public.whatsapp_provider_record,
  public.whatsapp_retry_buffer,
  public.whatsapp_sender_keys,
  public.whatsapp_signal_sessions
TO whatsapp_session_runtime;

-- Header, revision and handoff ownership/fence columns are controlled only by
-- SECURITY DEFINER lifecycle functions. A leased writer may update checkpoint
-- metadata, but cannot rewrite generation, epoch, capability, provider,
-- revision pointers or lease expiry/token directly.
GRANT SELECT ON TABLE
  public.whatsapp_session,
  public.whatsapp_session_revision,
  public.whatsapp_session_handoff
TO whatsapp_session_runtime;
GRANT UPDATE (
  last_persisted_at,
  updated_at
) ON TABLE public.whatsapp_session
TO whatsapp_session_runtime;
GRANT UPDATE (
  status,
  checksum_sha256,
  size_bytes,
  error_code,
  persisted_at,
  validated_at
) ON TABLE public.whatsapp_session_revision
TO whatsapp_session_runtime;
GRANT UPDATE (
  state,
  error_code,
  updated_at
) ON TABLE public.whatsapp_session_handoff
TO whatsapp_session_runtime;

-- The same worker connection carries capability-fenced runtime status and the
-- small, explicit set of application reads/writes used by all three workers,
-- including legacy-volume channels. Keep this list closed: new worker imports
-- must receive an explicit security review before their table is added here.
GRANT SELECT ON TABLE
  public.account,
  public.worker,
  public.worker_runtime,
  public.worker_config,
  public.chatbot,
  public.message_template,
  public.message_template_channel,
  public.message_status,
  public.account_plan_product_entitlement_revision,
  public.plan,
  public.plan_account,
  public.plan_cross_sell,
  public.plan_cross_sell_account,
  public.plan_items,
  public.outbound_webhook,
  public.outbound_webhook_subscription,
  public.outbound_webhook_event,
  public.outbound_webhook_delivery
TO whatsapp_session_runtime;
GRANT INSERT, UPDATE ON TABLE
  public.outbound_webhook_event,
  public.outbound_webhook_delivery
TO whatsapp_session_runtime;
GRANT INSERT (
  account_id,
  plan_product_id,
  revision,
  allowed,
  updated_at
) ON TABLE public.account_plan_product_entitlement_revision
TO whatsapp_session_runtime;
GRANT UPDATE (
  revision,
  allowed,
  updated_at
) ON TABLE public.account_plan_product_entitlement_revision
TO whatsapp_session_runtime;

GRANT EXECUTE ON FUNCTION public.acquire_whatsapp_session_lease(
  uuid, uuid, text, integer, uuid, integer, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(
  uuid, uuid, text, integer, uuid, text, text, uuid
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.apply_worker_runtime_status(
  uuid, uuid, text, integer, uuid, text, text, jsonb, uuid
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_handoff_source_read(
  uuid, bigint, uuid, bigint, integer, uuid, text, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_session_operation(
  uuid, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.begin_whatsapp_worker_operation(
  uuid, uuid, text, integer, uuid, text, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.clear_whatsapp_session(
  uuid, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_session_candidate(
  uuid, bigint, uuid, text, bigint, integer, uuid, text, text, integer,
  integer, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_session_pairing(
  uuid, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.hydrate_whatsapp_warm_runtime(
  uuid, text, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.open_whatsapp_session_revision(
  uuid, uuid, text, bigint, integer, uuid, text, text, integer, integer, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.promote_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.release_whatsapp_session_lease(
  uuid, uuid, text, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.renew_whatsapp_session_lease(
  uuid, uuid, text, bigint, integer, uuid, integer, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.request_worker_self_heal(
  uuid, uuid, text, integer, uuid, text, text, text, jsonb, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.read_whatsapp_worker_typing_config(
  uuid, uuid, text, integer, uuid, text, text, uuid
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.read_whatsapp_worker_call_config(
  uuid, uuid, text, integer, uuid, text, text, uuid, uuid
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_worker_s3_backup(
  uuid, uuid, text, integer, uuid, text, text, text, text, text, text,
  integer, integer, integer, text, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.rollback_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text
) TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_worker_operation_scope_is_valid()
  TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_worker_scope_owns_plan(uuid)
  TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_worker_scope_owns_cross_sell(uuid)
  TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_worker_scope_owns_template(uuid)
  TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_worker_scope_owns_webhook(uuid)
  TO whatsapp_session_runtime;
GRANT EXECUTE ON FUNCTION public.whatsapp_worker_scope_owns_event(uuid)
  TO whatsapp_session_runtime;
