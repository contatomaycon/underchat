-- v15 -> v16 (compatible with v16+): Convert legacy device/JID store to session scopes

CREATE TABLE IF NOT EXISTS whatsapp_store_version (
	version INTEGER NOT NULL,
	compat INTEGER NOT NULL,
	CHECK (version = 16 AND compat = 16)
);
DELETE FROM whatsapp_store_version;
INSERT INTO whatsapp_store_version (version, compat) VALUES (16, 16);

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

CREATE TABLE whatsapp_session_revision (
	session_id      UUID NOT NULL,
	revision_id     BIGINT NOT NULL CHECK (revision_id > 0),
	provider        TEXT NOT NULL,
	status          TEXT NOT NULL DEFAULT 'staging',
	source           TEXT,
	schema_version  INTEGER NOT NULL,
	codec_version   INTEGER NOT NULL,
	format           TEXT NOT NULL DEFAULT 'whatsmeow-protobuf',
	checksum         bytea,
	size_bytes       BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
	created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (session_id, revision_id),
	FOREIGN KEY (session_id) REFERENCES whatsapp_session(session_id) ON DELETE CASCADE
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
	adv_details bytea,
	adv_account_sig bytea CHECK (length(adv_account_sig) = 64),
	adv_account_sig_key bytea CHECK (length(adv_account_sig_key) = 32),
	adv_device_sig bytea CHECK (length(adv_device_sig) = 64),
	platform TEXT NOT NULL DEFAULT '',
	business_name TEXT NOT NULL DEFAULT '',
	push_name TEXT NOT NULL DEFAULT '',
	lid_migration_ts BIGINT NOT NULL DEFAULT 0,
	device_fingerprint bytea CHECK (device_fingerprint IS NULL OR length(device_fingerprint) = 32),
	next_pre_key_id INTEGER NOT NULL DEFAULT 1 CHECK (next_pre_key_id > 0 AND next_pre_key_id <= 16777216),
	CHECK (
		(
			registration_id IS NULL AND noise_key IS NULL AND identity_key IS NULL
			AND signed_pre_key IS NULL AND signed_pre_key_id IS NULL AND signed_pre_key_sig IS NULL
			AND adv_key IS NULL AND adv_details IS NULL AND adv_account_sig IS NULL
			AND adv_account_sig_key IS NULL AND adv_device_sig IS NULL
		)
		OR
		(
			registration_id IS NOT NULL AND noise_key IS NOT NULL AND identity_key IS NOT NULL
			AND signed_pre_key IS NOT NULL AND signed_pre_key_id IS NOT NULL AND signed_pre_key_sig IS NOT NULL
			AND adv_key IS NOT NULL AND adv_details IS NOT NULL AND adv_account_sig IS NOT NULL
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

CREATE TABLE whatsapp_signal_sessions (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	their_id TEXT NOT NULL,
	session bytea,
	PRIMARY KEY (session_id, revision_id, their_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_sender_keys (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	chat_id TEXT NOT NULL,
	sender_id TEXT NOT NULL,
	sender_key bytea NOT NULL,
	PRIMARY KEY (session_id, revision_id, chat_id, sender_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_app_state_sync_keys (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	key_id bytea NOT NULL,
	key_data bytea NOT NULL,
	timestamp BIGINT NOT NULL,
	fingerprint bytea NOT NULL,
	PRIMARY KEY (session_id, revision_id, key_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

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
	key bytea NOT NULL,
	PRIMARY KEY (session_id, revision_id, chat_jid, sender_jid, message_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_privacy_tokens (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	their_jid TEXT NOT NULL,
	token bytea NOT NULL,
	timestamp BIGINT NOT NULL,
	sender_timestamp BIGINT,
	PRIMARY KEY (session_id, revision_id, their_jid),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE INDEX whatsapp_privacy_tokens_expiry_idx ON whatsapp_privacy_tokens (session_id, revision_id, timestamp);

CREATE TABLE whatsapp_nct_salt (
	session_id UUID NOT NULL,
	revision_id BIGINT NOT NULL,
	salt bytea NOT NULL,
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
	plaintext bytea,
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
	plaintext bytea NOT NULL,
	timestamp BIGINT NOT NULL,
	PRIMARY KEY (session_id, revision_id, chat_jid, message_id),
	FOREIGN KEY (session_id, revision_id) REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE INDEX whatsapp_retry_buffer_expiry_idx ON whatsapp_retry_buffer (session_id, revision_id, timestamp);

-- Preserve every v15 projection under a stable UUID scope. The v15 SQLite
-- schema permits an empty session_id, but the v17 stores require UUID session
-- ownership. Assign the missing scope before copying so every dependent table
-- uses the same value and no account JID becomes an internal session key.
UPDATE whatsmeow_device
SET session_id = lower(
	hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' ||
	hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' ||
	hex(randomblob(6))
)
WHERE session_id = '';

INSERT INTO whatsapp_session (session_id, provider, state, active_revision_id, generation, epoch)
SELECT d.session_id, 'whatsmeow', 'ready', 1, 1,
       '00000000-0000-0000-0000-000000000000'
FROM whatsmeow_device AS d;

INSERT INTO whatsapp_session_revision (
	session_id, revision_id, provider, status, source, schema_version,
	codec_version, format
)
SELECT d.session_id, 1, 'whatsmeow', 'active',
       'legacy_sqlite', 16, 1, 'whatsmeow-sqlstore-v15'
FROM whatsmeow_device AS d;

INSERT INTO whatsapp_device (
	session_id, revision_id, jid, lid, facebook_uuid, registration_id,
	noise_key, identity_key, signed_pre_key, signed_pre_key_id,
	signed_pre_key_sig, adv_key, adv_details, adv_account_sig,
	adv_account_sig_key, adv_device_sig, platform, business_name, push_name,
	lid_migration_ts, next_pre_key_id
)
SELECT d.session_id, 1, d.jid, d.lid,
       d.facebook_uuid, d.registration_id, d.noise_key, d.identity_key,
       d.signed_pre_key, d.signed_pre_key_id, d.signed_pre_key_sig,
       d.adv_key, d.adv_details, d.adv_account_sig, d.adv_account_sig_key,
       d.adv_device_sig, d.platform, d.business_name, d.push_name,
       d.lid_migration_ts,
       MIN(16777216, MAX(1, COALESCE((
		SELECT MAX(p.key_id) + 1 FROM whatsmeow_pre_keys AS p
		WHERE p.jid = d.jid
	), 1)))
FROM whatsmeow_device AS d;

INSERT INTO whatsapp_identity_keys (session_id, revision_id, their_id, identity)
SELECT d.session_id, 1, s.their_id, s.identity
FROM whatsmeow_identity_keys AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_pre_keys (session_id, revision_id, key_id, key, uploaded)
SELECT d.session_id, 1, s.key_id, s.key, s.uploaded
FROM whatsmeow_pre_keys AS s JOIN whatsmeow_device AS d ON d.jid = s.jid;
INSERT INTO whatsapp_signal_sessions (session_id, revision_id, their_id, session)
SELECT d.session_id, 1, s.their_id, s.session
FROM whatsmeow_sessions AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_sender_keys (session_id, revision_id, chat_id, sender_id, sender_key)
SELECT d.session_id, 1, s.chat_id, s.sender_id, s.sender_key
FROM whatsmeow_sender_keys AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_app_state_sync_keys (session_id, revision_id, key_id, key_data, timestamp, fingerprint)
SELECT d.session_id, 1, s.key_id, s.key_data, s.timestamp, s.fingerprint
FROM whatsmeow_app_state_sync_keys AS s JOIN whatsmeow_device AS d ON d.jid = s.jid;
INSERT INTO whatsapp_app_state_version (session_id, revision_id, name, version, hash)
SELECT d.session_id, 1, s.name, s.version, s.hash
FROM whatsmeow_app_state_version AS s JOIN whatsmeow_device AS d ON d.jid = s.jid;
INSERT INTO whatsapp_app_state_mutation_macs (session_id, revision_id, name, version, index_mac, value_mac)
SELECT d.session_id, 1, s.name, s.version, s.index_mac, s.value_mac
FROM whatsmeow_app_state_mutation_macs AS s JOIN whatsmeow_device AS d ON d.jid = s.jid;
INSERT INTO whatsapp_contacts (session_id, revision_id, their_jid, first_name, full_name, push_name, business_name, redacted_phone)
SELECT d.session_id, 1, s.their_jid, s.first_name, s.full_name, s.push_name, s.business_name, s.redacted_phone
FROM whatsmeow_contacts AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_chat_settings (session_id, revision_id, chat_jid, muted_until, pinned, archived)
SELECT d.session_id, 1, s.chat_jid, s.muted_until, s.pinned, s.archived
FROM whatsmeow_chat_settings AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_message_secrets (session_id, revision_id, chat_jid, sender_jid, message_id, key)
SELECT d.session_id, 1, s.chat_jid, s.sender_jid, s.message_id, s.key
FROM whatsmeow_message_secrets AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_privacy_tokens (session_id, revision_id, their_jid, token, timestamp, sender_timestamp)
SELECT d.session_id, 1, s.their_jid, s.token, s.timestamp, s.sender_timestamp
FROM whatsmeow_privacy_tokens AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_nct_salt (session_id, revision_id, salt)
SELECT d.session_id, 1, s.salt
FROM whatsmeow_nct_salt AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_lid_map (session_id, revision_id, lid, pn)
SELECT d.session_id, 1, s.lid, s.pn
FROM whatsmeow_lid_map AS s CROSS JOIN whatsmeow_device AS d;
INSERT INTO whatsapp_event_buffer (session_id, revision_id, ciphertext_hash, plaintext, server_timestamp, insert_timestamp)
SELECT d.session_id, 1, s.ciphertext_hash, s.plaintext, s.server_timestamp, s.insert_timestamp
FROM whatsmeow_event_buffer AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;
INSERT INTO whatsapp_retry_buffer (session_id, revision_id, chat_jid, message_id, format, plaintext, timestamp)
SELECT d.session_id, 1, s.chat_jid, s.message_id, s.format, s.plaintext, s.timestamp
FROM whatsmeow_retry_buffer AS s JOIN whatsmeow_device AS d ON d.jid = s.our_jid;

DROP TABLE whatsmeow_app_state_mutation_macs;
DROP TABLE whatsmeow_app_state_version;
DROP TABLE whatsmeow_app_state_sync_keys;
DROP TABLE whatsmeow_chat_settings;
DROP TABLE whatsmeow_contacts;
DROP TABLE whatsmeow_event_buffer;
DROP TABLE whatsmeow_identity_keys;
DROP TABLE whatsmeow_message_secrets;
DROP TABLE whatsmeow_nct_salt;
DROP TABLE whatsmeow_pre_keys;
DROP TABLE whatsmeow_privacy_tokens;
DROP TABLE whatsmeow_retry_buffer;
DROP TABLE whatsmeow_sender_keys;
DROP TABLE whatsmeow_sessions;
DROP TABLE whatsmeow_lid_map;
DROP TABLE whatsmeow_device;
