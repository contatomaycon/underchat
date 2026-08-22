-- v0 -> v17 (compatible with v17+): Session-first WhatsApp store
-- dbutil owns the generic whatsapp_store_version cursor. Existing v15 stores
-- rename their legacy cursor before this migration is selected.

CREATE TABLE whatsapp_session (
	session_id          UUID PRIMARY KEY,
	provider            TEXT NOT NULL DEFAULT 'whatsmeow',
	state               TEXT NOT NULL DEFAULT 'staging',
	active_revision_id  BIGINT,
	previous_revision_id BIGINT,
	generation          BIGINT NOT NULL DEFAULT 1 CHECK (generation > 0),
	epoch               UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
	capability_hash     TEXT,
	created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A v2 companion is reserved before a provider opens its network socket.
-- Revisions of one session share the row; a second session cannot reserve the
-- same fingerprint. The FK releases it when the session is deleted.
CREATE TABLE whatsapp_companion_reservation (
	fingerprint_version TEXT NOT NULL,
	device_fingerprint bytea NOT NULL,
	session_id UUID NOT NULL UNIQUE,
	reserved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CHECK (
		fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
		AND length(device_fingerprint) = 32
	),
	PRIMARY KEY (fingerprint_version, device_fingerprint),
	FOREIGN KEY (session_id) REFERENCES whatsapp_session(session_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_session_revision (
	session_id      UUID NOT NULL,
	revision_id     BIGINT NOT NULL CHECK (revision_id > 0),
	provider        TEXT NOT NULL,
	status          TEXT NOT NULL DEFAULT 'staging',
	source           TEXT,
	schema_version  INTEGER NOT NULL DEFAULT 17 CHECK (schema_version = 17),
	codec_version   INTEGER NOT NULL CHECK (codec_version > 0),
	format           TEXT NOT NULL DEFAULT 'whatsmeow-protobuf',
	checksum         bytea,
	size_bytes       BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
	created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (session_id, revision_id),
	FOREIGN KEY (session_id) REFERENCES whatsapp_session(session_id) ON DELETE CASCADE
);

-- Provider-neutral and provider-private opaque records. The routing store only
-- reads/writes the exact whatsapp/transport:routing_info key and applies its
-- tighter 65,535-byte contract in the library.
CREATE TABLE whatsapp_provider_record (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	namespace VARCHAR(100) NOT NULL,
	record_key VARCHAR(500) NOT NULL,
	codec_version INTEGER NOT NULL DEFAULT 1 CHECK (codec_version > 0),
	payload bytea NOT NULL CHECK (length(payload) BETWEEN 1 AND 8388608),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (session_id, revision_id, namespace, record_key),
	FOREIGN KEY (session_id, revision_id)
		REFERENCES whatsapp_session_revision(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_device (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	jid TEXT,
	lid TEXT,
	facebook_uuid UUID,
	registration_id BIGINT CHECK (registration_id >= 0 AND registration_id < 4294967296),
	noise_key bytea CHECK (length(noise_key) = 32),
	identity_key bytea CHECK (length(identity_key) = 32),
	signed_pre_key bytea CHECK (length(signed_pre_key) = 32),
	signed_pre_key_id INTEGER CHECK (signed_pre_key_id >= 0 AND signed_pre_key_id < 16777216),
	signed_pre_key_sig bytea CHECK (length(signed_pre_key_sig) = 64),
	adv_key bytea,
	adv_secret_available BOOLEAN NOT NULL DEFAULT false,
	adv_details bytea CHECK (adv_details IS NULL OR length(adv_details) BETWEEN 1 AND 1048576),
	adv_account_sig bytea CHECK (length(adv_account_sig) = 64),
	adv_account_sig_key bytea CHECK (length(adv_account_sig_key) = 32),
	adv_device_sig bytea CHECK (length(adv_device_sig) = 64),
	platform TEXT NOT NULL DEFAULT '',
	business_name TEXT NOT NULL DEFAULT '',
	push_name TEXT NOT NULL DEFAULT '',
	lid_migration_ts BIGINT NOT NULL DEFAULT 0,
	device_fingerprint bytea,
	fingerprint_version TEXT,
	next_pre_key_id INTEGER NOT NULL DEFAULT 1 CHECK (next_pre_key_id > 0 AND next_pre_key_id <= 16777216),
	CHECK (
		(
			registration_id IS NULL AND noise_key IS NULL AND identity_key IS NULL
			AND signed_pre_key IS NULL AND signed_pre_key_id IS NULL AND signed_pre_key_sig IS NULL
			AND adv_details IS NULL AND adv_account_sig IS NULL
			AND adv_account_sig_key IS NULL AND adv_device_sig IS NULL
		)
		OR
		(
			registration_id IS NOT NULL AND noise_key IS NOT NULL AND identity_key IS NOT NULL
			AND signed_pre_key IS NOT NULL AND signed_pre_key_id IS NOT NULL AND signed_pre_key_sig IS NOT NULL
			AND adv_details IS NOT NULL AND adv_account_sig IS NOT NULL
			AND adv_account_sig_key IS NOT NULL AND adv_device_sig IS NOT NULL
		)
	),
	CHECK (
		(
			adv_secret_available AND adv_key IS NOT NULL AND length(adv_key) = 32
			AND registration_id IS NOT NULL AND noise_key IS NOT NULL
			AND identity_key IS NOT NULL AND signed_pre_key IS NOT NULL
			AND signed_pre_key_id IS NOT NULL AND signed_pre_key_sig IS NOT NULL
			AND adv_details IS NOT NULL AND adv_account_sig IS NOT NULL
			AND adv_account_sig_key IS NOT NULL AND adv_device_sig IS NOT NULL
		)
		OR (NOT adv_secret_available AND adv_key IS NULL)
	),
	CHECK (
		(device_fingerprint IS NULL AND fingerprint_version IS NULL)
		OR (
			device_fingerprint IS NOT NULL AND length(device_fingerprint) = 32
			AND fingerprint_version IS NOT NULL
			AND fingerprint_version IN (
				'underchat-whatsapp-device-fingerprint-v1',
				'underchat-whatsapp-device-fingerprint-v2'
			)
			AND registration_id IS NOT NULL AND noise_key IS NOT NULL
			AND identity_key IS NOT NULL AND signed_pre_key IS NOT NULL
			AND signed_pre_key_id IS NOT NULL AND signed_pre_key_sig IS NOT NULL
			AND adv_details IS NOT NULL AND adv_account_sig IS NOT NULL
			AND adv_account_sig_key IS NOT NULL AND adv_device_sig IS NOT NULL
		)
	),
	PRIMARY KEY (session_id, revision_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_session_revision(session_id, revision_id) ON DELETE CASCADE
);

CREATE INDEX whatsapp_device_jid_session_idx ON whatsapp_device (jid, session_id) WHERE jid IS NOT NULL;

CREATE TABLE whatsapp_identity_keys (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	their_id TEXT NOT NULL,
	identity bytea NOT NULL CHECK (length(identity) = 32),
	PRIMARY KEY (session_id, revision_id, their_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_pre_keys (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	key_id INTEGER NOT NULL CHECK (key_id >= 0 AND key_id < 16777216),
	key bytea NOT NULL CHECK (length(key) = 32),
	uploaded BOOLEAN NOT NULL,
	PRIMARY KEY (session_id, revision_id, key_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE INDEX whatsapp_pre_keys_pending_idx ON whatsapp_pre_keys (session_id, revision_id, key_id) WHERE uploaded = false;

-- Portable ML-KEM material is owned by Baileys-compatible providers. The
-- WhatsMeow runtime does not consume these rows, but the canonical standalone
-- schema must preserve their exact session/revision ownership and codec.
CREATE TABLE whatsapp_pq_pre_keys (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	key_id INTEGER NOT NULL CHECK (key_id >= 0 AND key_id < 16777215),
	key_kind TEXT NOT NULL CHECK (key_kind IN ('one_time', 'last_resort')),
	public_key bytea NOT NULL CHECK (length(public_key) = 1568),
	private_key bytea NOT NULL CHECK (length(private_key) = 3168),
	signature bytea NOT NULL CHECK (length(signature) = 64),
	timestamp_ms BIGINT NOT NULL CHECK (timestamp_ms >= 0),
	sent_to_server BOOLEAN NOT NULL DEFAULT false,
	PRIMARY KEY (session_id, revision_id, key_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX whatsapp_pq_pre_keys_last_resort_uidx
	ON whatsapp_pq_pre_keys (session_id, revision_id)
	WHERE key_kind = 'last_resort';

CREATE INDEX whatsapp_pq_pre_keys_pending_idx
	ON whatsapp_pq_pre_keys (session_id, revision_id, key_id)
	WHERE key_kind = 'one_time' AND sent_to_server = false;

CREATE TABLE whatsapp_pq_pre_key_state (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	codec_version INTEGER NOT NULL DEFAULT 1,
	algorithm TEXT NOT NULL DEFAULT 'ML-KEM-1024',
	next_pre_key_id INTEGER NOT NULL DEFAULT 1 CHECK (next_pre_key_id >= 0 AND next_pre_key_id < 16777215),
	migrated BOOLEAN NOT NULL DEFAULT false,
	last_server_count INTEGER,
	last_server_count_timestamp_ms BIGINT,
	CHECK (codec_version = 1 AND algorithm = 'ML-KEM-1024'),
	CHECK (
		(last_server_count IS NULL AND last_server_count_timestamp_ms IS NULL)
		OR (
			last_server_count IS NOT NULL
			AND last_server_count_timestamp_ms IS NOT NULL
			AND last_server_count >= 0
			AND last_server_count_timestamp_ms >= 0
		)
	),
	PRIMARY KEY (session_id, revision_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_signal_sessions (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	their_id TEXT NOT NULL,
	scope TEXT NOT NULL DEFAULT 'default' CHECK (scope IN ('default', 'status', 'pq')),
	session bytea CHECK (session IS NULL OR length(session) BETWEEN 1 AND 8388608),
	PRIMARY KEY (session_id, revision_id, their_id, scope),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_sender_keys (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	chat_id TEXT NOT NULL,
	sender_id TEXT NOT NULL,
	sender_key bytea NOT NULL CHECK (length(sender_key) BETWEEN 1 AND 2097152),
	PRIMARY KEY (session_id, revision_id, chat_id, sender_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_app_state_sync_keys (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	key_id bytea NOT NULL CHECK (length(key_id) BETWEEN 1 AND 1048576),
	key_data bytea NOT NULL CHECK (length(key_data) BETWEEN 1 AND 1048576),
	timestamp BIGINT NOT NULL,
	fingerprint bytea NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 1048576),
	PRIMARY KEY (session_id, revision_id, key_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

-- only: postgres
CREATE INDEX whatsapp_app_state_sync_keys_latest_idx ON whatsapp_app_state_sync_keys (session_id, revision_id, timestamp DESC) INCLUDE (key_id);
-- only: sqlite
CREATE INDEX whatsapp_app_state_sync_keys_latest_idx ON whatsapp_app_state_sync_keys (session_id, revision_id, timestamp DESC, key_id);

CREATE TABLE whatsapp_app_state_version (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	name TEXT NOT NULL,
	version BIGINT NOT NULL,
	hash bytea NOT NULL CHECK (length(hash) = 128),
	PRIMARY KEY (session_id, revision_id, name),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_app_state_mutation_macs (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	name TEXT NOT NULL,
	version BIGINT NOT NULL,
	index_mac bytea NOT NULL CHECK (length(index_mac) = 32),
	value_mac bytea NOT NULL CHECK (length(value_mac) = 32),
	PRIMARY KEY (session_id, revision_id, name, index_mac, version),
	FOREIGN KEY (session_id, revision_id, name) REFERENCES whatsapp_app_state_version(session_id, revision_id, name) ON DELETE CASCADE
);

CREATE TABLE whatsapp_contacts (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	their_jid TEXT NOT NULL,
	first_name TEXT,
	full_name TEXT,
	push_name TEXT,
	business_name TEXT,
	redacted_phone TEXT,
	PRIMARY KEY (session_id, revision_id, their_jid),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_chat_settings (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	chat_jid TEXT NOT NULL,
	muted_until BIGINT NOT NULL DEFAULT 0,
	pinned BOOLEAN NOT NULL DEFAULT false,
	archived BOOLEAN NOT NULL DEFAULT false,
	PRIMARY KEY (session_id, revision_id, chat_jid),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_message_secrets (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	chat_jid TEXT NOT NULL,
	sender_jid TEXT NOT NULL,
	message_id TEXT NOT NULL,
	key bytea NOT NULL CHECK (length(key) BETWEEN 1 AND 1048576),
	PRIMARY KEY (session_id, revision_id, chat_jid, sender_jid, message_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_privacy_tokens (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	their_jid TEXT NOT NULL,
	token bytea NOT NULL CHECK (length(token) BETWEEN 1 AND 1048576),
	timestamp BIGINT NOT NULL,
	sender_timestamp BIGINT,
	PRIMARY KEY (session_id, revision_id, their_jid),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE INDEX whatsapp_privacy_tokens_expiry_idx ON whatsapp_privacy_tokens (session_id, revision_id, timestamp);

CREATE TABLE whatsapp_nct_salt (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	salt bytea NOT NULL CHECK (length(salt) BETWEEN 1 AND 1048576),
	PRIMARY KEY (session_id, revision_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_lid_map (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	lid TEXT NOT NULL,
	pn TEXT NOT NULL,
	PRIMARY KEY (session_id, revision_id, lid),
	UNIQUE (session_id, revision_id, pn),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_event_buffer (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	ciphertext_hash bytea NOT NULL CHECK (length(ciphertext_hash) = 32),
	plaintext bytea CHECK (plaintext IS NULL OR length(plaintext) <= 8388608),
	server_timestamp BIGINT NOT NULL,
	insert_timestamp BIGINT NOT NULL,
	PRIMARY KEY (session_id, revision_id, ciphertext_hash),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE INDEX whatsapp_event_buffer_expiry_idx ON whatsapp_event_buffer (session_id, revision_id, insert_timestamp);

CREATE TABLE whatsapp_retry_buffer (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	chat_jid TEXT NOT NULL,
	message_id TEXT NOT NULL,
	format TEXT NOT NULL,
	plaintext bytea NOT NULL CHECK (length(plaintext) <= 8388608),
	timestamp BIGINT NOT NULL,
	PRIMARY KEY (session_id, revision_id, chat_jid, message_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE INDEX whatsapp_retry_buffer_expiry_idx ON whatsapp_retry_buffer (session_id, revision_id, timestamp);
