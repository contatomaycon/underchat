-- Optimize the global orphan-artifact sweep used by WhatsApp session GC.
-- The session-first primary key continues to serve scoped reads and RLS;
-- this index serves the bounded global retention scan in chronological order.
CREATE INDEX "whatsapp_artifact_blob_gc_idx"
  ON "public"."whatsapp_artifact_blob" ("created_at", "session_id", "sha256");
