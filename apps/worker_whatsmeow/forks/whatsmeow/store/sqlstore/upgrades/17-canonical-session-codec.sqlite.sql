-- v16 -> v17: versioned public companion identity and scoped Signal sessions.

DROP TABLE whatsapp_store_version;
CREATE TABLE whatsapp_store_version (
	version INTEGER NOT NULL,
	compat INTEGER NOT NULL,
	CHECK (version = 17 AND compat = 17)
);
INSERT INTO whatsapp_store_version (version, compat) VALUES (17, 17);

UPDATE whatsapp_session_revision SET schema_version = 17 WHERE schema_version = 16;

CREATE TABLE whatsapp_provider_record (
	session_id TEXT NOT NULL,
	revision_id INTEGER NOT NULL,
	namespace TEXT NOT NULL,
	record_key TEXT NOT NULL,
	codec_version INTEGER NOT NULL DEFAULT 1 CHECK (codec_version > 0),
	payload BLOB NOT NULL CHECK (length(payload) BETWEEN 1 AND 8388608),
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (session_id, revision_id, namespace, record_key),
	FOREIGN KEY (session_id, revision_id)
		REFERENCES whatsapp_session_revision(session_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE whatsapp_pq_pre_keys (
	session_id TEXT NOT NULL,
	revision_id INTEGER NOT NULL,
	key_id INTEGER NOT NULL CHECK (key_id >= 0 AND key_id < 16777215),
	key_kind TEXT NOT NULL CHECK (key_kind IN ('one_time', 'last_resort')),
	public_key BLOB NOT NULL CHECK (length(public_key) = 1568),
	private_key BLOB NOT NULL CHECK (length(private_key) = 3168),
	signature BLOB NOT NULL CHECK (length(signature) = 64),
	timestamp_ms INTEGER NOT NULL CHECK (timestamp_ms >= 0),
	sent_to_server BOOLEAN NOT NULL DEFAULT false,
	PRIMARY KEY (session_id, revision_id, key_id),
	FOREIGN KEY (session_id, revision_id)
		REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX whatsapp_pq_pre_keys_last_resort_uidx
	ON whatsapp_pq_pre_keys (session_id, revision_id)
	WHERE key_kind = 'last_resort';

CREATE INDEX whatsapp_pq_pre_keys_pending_idx
	ON whatsapp_pq_pre_keys (session_id, revision_id, key_id)
	WHERE key_kind = 'one_time' AND sent_to_server = false;

CREATE TABLE whatsapp_pq_pre_key_state (
	session_id TEXT NOT NULL,
	revision_id INTEGER NOT NULL,
	codec_version INTEGER NOT NULL DEFAULT 1,
	algorithm TEXT NOT NULL DEFAULT 'ML-KEM-1024',
	next_pre_key_id INTEGER NOT NULL DEFAULT 1 CHECK (next_pre_key_id >= 0 AND next_pre_key_id < 16777215),
	migrated BOOLEAN NOT NULL DEFAULT false,
	last_server_count INTEGER,
	last_server_count_timestamp_ms INTEGER,
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
	FOREIGN KEY (session_id, revision_id)
		REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);

-- v15 had one global LID map with no recoverable device/session owner. The
-- immutable v16 migration copied that cache into every session. Drop every
-- derived mapping at the v17 boundary so no channel can observe another
-- channel's legacy cache; native app-state/contact sync rebuilds it per scope.
DELETE FROM whatsapp_lid_map;

ALTER TABLE whatsapp_device
	ADD COLUMN adv_secret_available BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE whatsapp_device ADD COLUMN fingerprint_version TEXT;
UPDATE whatsapp_device SET adv_secret_available = adv_key IS NOT NULL;
UPDATE whatsapp_device SET device_fingerprint = NULL, fingerprint_version = NULL;

ALTER TABLE whatsapp_signal_sessions RENAME TO whatsapp_signal_sessions_v16;
CREATE TABLE whatsapp_signal_sessions (
	session_id TEXT NOT NULL,
	revision_id INTEGER NOT NULL,
	their_id TEXT NOT NULL,
	scope TEXT NOT NULL DEFAULT 'default' CHECK (scope IN ('default', 'status', 'pq')),
	session BLOB CHECK (session IS NULL OR length(session) BETWEEN 1 AND 8388608),
	PRIMARY KEY (session_id, revision_id, their_id, scope),
	FOREIGN KEY (session_id, revision_id)
		REFERENCES whatsapp_device(session_id, revision_id) ON DELETE CASCADE
);
INSERT INTO whatsapp_signal_sessions (
	session_id, revision_id, their_id, scope, session
)
SELECT session_id, revision_id, their_id, 'default', session
FROM whatsapp_signal_sessions_v16;
DROP TABLE whatsapp_signal_sessions_v16;

CREATE TABLE whatsapp_companion_reservation (
	fingerprint_version TEXT NOT NULL,
	device_fingerprint BLOB NOT NULL,
	session_id TEXT NOT NULL UNIQUE,
	reserved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CHECK (
		fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
		AND length(device_fingerprint) = 32
	),
	PRIMARY KEY (fingerprint_version, device_fingerprint),
	FOREIGN KEY (session_id) REFERENCES whatsapp_session(session_id) ON DELETE CASCADE
);

CREATE TRIGGER whatsapp_device_companion_reservation_insert_guard_v17
BEFORE INSERT ON whatsapp_device
WHEN NEW.fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
	AND (
		EXISTS (
			SELECT 1 FROM whatsapp_companion_reservation
			WHERE fingerprint_version = NEW.fingerprint_version
				AND device_fingerprint = NEW.device_fingerprint
				AND session_id <> NEW.session_id
		)
		OR EXISTS (
			SELECT 1 FROM whatsapp_companion_reservation
			WHERE session_id = NEW.session_id
				AND (
					fingerprint_version <> NEW.fingerprint_version
					OR device_fingerprint <> NEW.device_fingerprint
				)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'whatsapp companion identity is reserved by another session');
END;

CREATE TRIGGER whatsapp_device_companion_reservation_insert_v17
AFTER INSERT ON whatsapp_device
WHEN NEW.fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
BEGIN
	INSERT OR IGNORE INTO whatsapp_companion_reservation (
		fingerprint_version, device_fingerprint, session_id
	) VALUES (
		NEW.fingerprint_version, NEW.device_fingerprint, NEW.session_id
	);
END;

CREATE TRIGGER whatsapp_device_companion_reservation_update_guard_v17
BEFORE UPDATE OF device_fingerprint, fingerprint_version ON whatsapp_device
WHEN NEW.fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
	AND (
		EXISTS (
			SELECT 1 FROM whatsapp_companion_reservation
			WHERE fingerprint_version = NEW.fingerprint_version
				AND device_fingerprint = NEW.device_fingerprint
				AND session_id <> NEW.session_id
		)
		OR EXISTS (
			SELECT 1 FROM whatsapp_companion_reservation
			WHERE session_id = NEW.session_id
				AND (
					fingerprint_version <> NEW.fingerprint_version
					OR device_fingerprint <> NEW.device_fingerprint
				)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'whatsapp companion identity is reserved by another session');
END;

CREATE TRIGGER whatsapp_device_companion_reservation_update_v17
AFTER UPDATE OF device_fingerprint, fingerprint_version ON whatsapp_device
WHEN NEW.fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
BEGIN
	INSERT OR IGNORE INTO whatsapp_companion_reservation (
		fingerprint_version, device_fingerprint, session_id
	) VALUES (
		NEW.fingerprint_version, NEW.device_fingerprint, NEW.session_id
	);
END;

CREATE TRIGGER whatsapp_device_companion_reservation_delete_v17
AFTER DELETE ON whatsapp_device
BEGIN
	DELETE FROM whatsapp_companion_reservation
	WHERE session_id = OLD.session_id
		AND NOT EXISTS (
			SELECT 1 FROM whatsapp_device
			WHERE session_id = OLD.session_id
				AND fingerprint_version = 'underchat-whatsapp-device-fingerprint-v2'
		);
END;

CREATE TRIGGER whatsapp_session_companion_reservation_empty_v17
AFTER UPDATE OF state ON whatsapp_session
WHEN NEW.state = 'empty'
BEGIN
	DELETE FROM whatsapp_companion_reservation WHERE session_id = NEW.session_id;
END;

-- Existing sender keys are already scoped in v16. SQLite cannot add a table
-- constraint in place, so runtime codec validation remains the enforcement
-- boundary for upgraded stores; fresh v17 stores include the 2 MiB CHECK.
