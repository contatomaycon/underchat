-- v16 -> v17: versioned public companion identity and scoped Signal sessions.

DROP TABLE whatsapp_store_version;
CREATE TABLE whatsapp_store_version (
	version INTEGER NOT NULL,
	compat INTEGER NOT NULL,
	CHECK (version = 17 AND compat = 17)
);
INSERT INTO whatsapp_store_version (version, compat) VALUES (17, 17);

UPDATE whatsapp_session_revision SET schema_version = 17 WHERE schema_version = 16;
ALTER TABLE whatsapp_session_revision
	ALTER COLUMN schema_version SET DEFAULT 17,
	ADD CHECK (schema_version = 17 AND codec_version > 0);

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

-- v15 had one global LID map with no recoverable device/session owner. The
-- immutable v16 migration copied that cache into every session. Drop every
-- derived mapping at the v17 boundary so no channel can observe another
-- channel's legacy cache; native app-state/contact sync rebuilds it per scope.
DELETE FROM whatsapp_lid_map;

ALTER TABLE whatsapp_device
	ADD COLUMN adv_secret_available BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN fingerprint_version TEXT;
UPDATE whatsapp_device SET adv_secret_available = adv_key IS NOT NULL;
-- The v1 digest included the ADV secret. Let the library recompute v2 from
-- the identity public key on the next native save.
UPDATE whatsapp_device SET device_fingerprint = NULL, fingerprint_version = NULL;

-- v16 required adv_key as part of the native credential all-or-nothing
-- constraint. v17 treats that private secret as an explicit capability while
-- retaining the signed public companion identity needed to reconnect.
ALTER TABLE whatsapp_device DROP CONSTRAINT IF EXISTS whatsapp_device_check;
ALTER TABLE whatsapp_device
	ADD CONSTRAINT whatsapp_device_native_credentials_v17_check CHECK (
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
	ADD CONSTRAINT whatsapp_device_adv_secret_v17_check CHECK (
		(
			adv_secret_available AND adv_key IS NOT NULL AND length(adv_key) = 32
			AND registration_id IS NOT NULL AND noise_key IS NOT NULL AND identity_key IS NOT NULL
			AND signed_pre_key IS NOT NULL AND signed_pre_key_id IS NOT NULL AND signed_pre_key_sig IS NOT NULL
			AND adv_details IS NOT NULL AND adv_account_sig IS NOT NULL
			AND adv_account_sig_key IS NOT NULL AND adv_device_sig IS NOT NULL
		)
		OR (NOT adv_secret_available AND adv_key IS NULL)
	),
	ADD CONSTRAINT whatsapp_device_fingerprint_version_v17_check CHECK (
		(device_fingerprint IS NULL AND fingerprint_version IS NULL)
		OR (
			device_fingerprint IS NOT NULL AND length(device_fingerprint) = 32
			AND fingerprint_version IS NOT NULL
			AND fingerprint_version IN (
				'underchat-whatsapp-device-fingerprint-v1',
				'underchat-whatsapp-device-fingerprint-v2'
			)
			AND registration_id IS NOT NULL AND noise_key IS NOT NULL AND identity_key IS NOT NULL
			AND signed_pre_key IS NOT NULL AND signed_pre_key_id IS NOT NULL AND signed_pre_key_sig IS NOT NULL
			AND adv_details IS NOT NULL AND adv_account_sig IS NOT NULL
			AND adv_account_sig_key IS NOT NULL AND adv_device_sig IS NOT NULL
		)
	);

ALTER TABLE whatsapp_signal_sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'default';
ALTER TABLE whatsapp_signal_sessions DROP CONSTRAINT whatsapp_signal_sessions_pkey;
ALTER TABLE whatsapp_signal_sessions
	ADD PRIMARY KEY (session_id, revision_id, their_id, scope),
	ADD CHECK (scope IN ('default', 'status', 'pq')),
	ADD CHECK (session IS NULL OR length(session) BETWEEN 1 AND 8388608);

ALTER TABLE whatsapp_sender_keys
	ADD CHECK (length(sender_key) BETWEEN 1 AND 2097152);

-- Broad defensive storage ceilings, not provider protocol length claims.
ALTER TABLE whatsapp_device
	ADD CHECK (adv_details IS NULL OR length(adv_details) BETWEEN 1 AND 1048576);
ALTER TABLE whatsapp_app_state_sync_keys
	ADD CHECK (
		length(key_id) BETWEEN 1 AND 1048576
		AND length(key_data) BETWEEN 1 AND 1048576
		AND length(fingerprint) BETWEEN 1 AND 1048576
	);
ALTER TABLE whatsapp_message_secrets
	ADD CHECK (length(key) BETWEEN 1 AND 1048576);
ALTER TABLE whatsapp_privacy_tokens
	ADD CHECK (length(token) BETWEEN 1 AND 1048576);
ALTER TABLE whatsapp_nct_salt
	ADD CHECK (length(salt) BETWEEN 1 AND 1048576);
ALTER TABLE whatsapp_event_buffer
	ADD CHECK (plaintext IS NULL OR length(plaintext) <= 8388608);
ALTER TABLE whatsapp_retry_buffer
	ADD CHECK (length(plaintext) <= 8388608);

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

CREATE OR REPLACE FUNCTION reserve_whatsapp_companion_v17()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
	reserved_session_id UUID;
BEGIN
	IF NEW.fingerprint_version IS DISTINCT FROM 'underchat-whatsapp-device-fingerprint-v2'
		OR NEW.device_fingerprint IS NULL
	THEN
		RETURN NEW;
	END IF;
	BEGIN
		INSERT INTO whatsapp_companion_reservation (
			fingerprint_version, device_fingerprint, session_id
		) VALUES (
			NEW.fingerprint_version, NEW.device_fingerprint, NEW.session_id
		)
		RETURNING session_id INTO reserved_session_id;
	EXCEPTION WHEN unique_violation THEN
		SELECT reservation.session_id INTO reserved_session_id
		FROM whatsapp_companion_reservation AS reservation
		WHERE reservation.fingerprint_version = NEW.fingerprint_version
			AND reservation.device_fingerprint = NEW.device_fingerprint;
		IF reserved_session_id IS NULL THEN
			RAISE EXCEPTION 'whatsapp session already reserves another companion identity'
				USING ERRCODE = '23505';
		END IF;
	END;
	IF reserved_session_id IS DISTINCT FROM NEW.session_id THEN
		RAISE EXCEPTION 'whatsapp companion identity is reserved by another session'
			USING ERRCODE = '23505';
	END IF;
	RETURN NEW;
END;
$function$;

CREATE TRIGGER whatsapp_device_companion_reservation_insert_v17
BEFORE INSERT ON whatsapp_device
FOR EACH ROW EXECUTE FUNCTION reserve_whatsapp_companion_v17();

CREATE TRIGGER whatsapp_device_companion_reservation_update_v17
BEFORE UPDATE OF device_fingerprint, fingerprint_version ON whatsapp_device
FOR EACH ROW EXECUTE FUNCTION reserve_whatsapp_companion_v17();

CREATE OR REPLACE FUNCTION release_deleted_whatsapp_companion_v17()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	DELETE FROM whatsapp_companion_reservation AS reservation
	WHERE reservation.session_id = OLD.session_id
		AND NOT EXISTS (
			SELECT 1 FROM whatsapp_device AS device
			WHERE device.session_id = OLD.session_id
				AND device.fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
		);
	RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION release_empty_whatsapp_companion_v17()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	IF NEW.state = 'empty' THEN
		DELETE FROM whatsapp_companion_reservation
		WHERE session_id = NEW.session_id;
	END IF;
	RETURN NEW;
END;
$function$;

CREATE TRIGGER whatsapp_device_companion_reservation_delete_v17
AFTER DELETE ON whatsapp_device
FOR EACH ROW EXECUTE FUNCTION release_deleted_whatsapp_companion_v17();

CREATE TRIGGER whatsapp_session_companion_reservation_empty_v17
AFTER UPDATE OF state ON whatsapp_session
FOR EACH ROW EXECUTE FUNCTION release_empty_whatsapp_companion_v17();
