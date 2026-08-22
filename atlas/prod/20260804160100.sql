-- atlas:txmode none

-- A Meta phone-number ID is globally unique. Build this index concurrently so
-- connection attempts cannot create multiple active official workers for the
-- same phone while normal production reads and writes continue.
CREATE UNIQUE INDEX CONCURRENTLY "worker_whatsapp_official_connection_active_phone_number_uidx"
  ON "public"."worker_whatsapp_official_connection" ("phone_number_id")
  WHERE "deleted_at" IS NULL;
