-- Modify "server" table
ALTER TABLE "server" ADD COLUMN "proxy_protocol" character varying(20) NOT NULL DEFAULT 'http';

INSERT INTO "worker_config_type" ("worker_config_type_id", "type") VALUES
  ('019c92b7-8d5f-779f-a51e-63b132be0dcb'::uuid, 'proxy_protocol')
ON CONFLICT ("worker_config_type_id") DO NOTHING;
