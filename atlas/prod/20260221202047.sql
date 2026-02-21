-- Modify "server" table
ALTER TABLE "server" ADD COLUMN "proxy_enabled" boolean NOT NULL DEFAULT false, ADD COLUMN "proxy_host" character varying(255) NULL, ADD COLUMN "proxy_port" integer NULL, ADD COLUMN "proxy_username" character varying(1000) NULL, ADD COLUMN "proxy_password" character varying(1000) NULL;
