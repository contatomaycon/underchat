-- v15: Bind devices to stable session IDs in shared stores
ALTER TABLE whatsmeow_device
ADD COLUMN session_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX whatsmeow_device_session_id_idx
ON whatsmeow_device (session_id);
ALTER TABLE whatsmeow_device ALTER COLUMN session_id DROP DEFAULT;
