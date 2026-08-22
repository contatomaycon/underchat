-- v15: Bind devices to stable session IDs in shared stores
ALTER TABLE whatsmeow_device ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX whatsmeow_device_session_id_idx
ON whatsmeow_device (session_id);
