-- Create "server_web" table
CREATE TABLE "server_web" (
  "server_web_id" uuid NOT NULL,
  "server_id" uuid NOT NULL,
  "web_domain" character varying(200) NOT NULL,
  "web_port" integer NOT NULL,
  "web_protocol" character varying(10) NOT NULL,
  "created_at" timestamptz NULL DEFAULT now(),
  "updated_at" timestamptz NULL DEFAULT now(),
  "deleted_at" timestamptz NULL,
  PRIMARY KEY ("server_web_id"),
  CONSTRAINT "server_web_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "server" ("server_id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
