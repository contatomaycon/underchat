CREATE TABLE IF NOT EXISTS "outbound_webhook" (
  "outbound_webhook_id" uuid PRIMARY KEY NOT NULL,
  "account_id" uuid NOT NULL,
  "name" varchar(200) NOT NULL,
  "url" varchar(2048) NOT NULL,
  "secret_hash" varchar(64) NOT NULL,
  "secret_encrypted" varchar(512) NOT NULL,
  "secret_preview" varchar(32) NOT NULL,
  "status" varchar(20) DEFAULT 'inactive' NOT NULL,
  "config_version" integer DEFAULT 1 NOT NULL,
  "consecutive_dead_deliveries" integer DEFAULT 0 NOT NULL,
  "suspended_at" timestamp with time zone,
  "suspension_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "outbound_webhook_account_id_account_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."account" ("account_id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "outbound_webhook_status_check"
    CHECK ("status" IN ('inactive', 'active', 'suspended')),
  CONSTRAINT "outbound_webhook_config_version_check"
    CHECK ("config_version" > 0),
  CONSTRAINT "outbound_webhook_consecutive_dead_deliveries_check"
    CHECK ("consecutive_dead_deliveries" >= 0)
);

CREATE TABLE IF NOT EXISTS "outbound_webhook_subscription" (
  "outbound_webhook_subscription_id" uuid PRIMARY KEY NOT NULL,
  "outbound_webhook_id" uuid NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "outbound_webhook_subscription_outbound_webhook_id_outbound_webhook_outbound_webhook_id_fk"
    FOREIGN KEY ("outbound_webhook_id")
    REFERENCES "public"."outbound_webhook" ("outbound_webhook_id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "outbound_webhook_event" (
  "outbound_webhook_event_id" uuid PRIMARY KEY NOT NULL,
  "account_id" uuid NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "state" varchar(20) DEFAULT 'preparing' NOT NULL,
  "aggregate_type" varchar(32) NOT NULL,
  "aggregate_id" varchar(255) NOT NULL,
  "payload" jsonb NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "source" varchar(64),
  "occurred_at" timestamp with time zone NOT NULL,
  "ready_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '30 days' NOT NULL,
  CONSTRAINT "outbound_webhook_event_account_id_account_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."account" ("account_id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "outbound_webhook_event_state_check"
    CHECK ("state" IN ('preparing', 'ready', 'cancelled', 'quarantined'))
);

CREATE TABLE IF NOT EXISTS "outbound_webhook_delivery" (
  "outbound_webhook_delivery_id" uuid PRIMARY KEY NOT NULL,
  "outbound_webhook_id" uuid NOT NULL,
  "outbound_webhook_event_id" uuid NOT NULL,
  "config_version" integer NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "dead_at" timestamp with time zone,
  "suppressed_at" timestamp with time zone,
  "last_error" text,
  "redelivery_of_delivery_id" uuid,
  "requested_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '30 days' NOT NULL,
  CONSTRAINT "outbound_webhook_delivery_outbound_webhook_id_outbound_webhook_outbound_webhook_id_fk"
    FOREIGN KEY ("outbound_webhook_id")
    REFERENCES "public"."outbound_webhook" ("outbound_webhook_id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "outbound_webhook_delivery_outbound_webhook_event_id_outbound_webhook_event_outbound_webhook_event_id_fk"
    FOREIGN KEY ("outbound_webhook_event_id")
    REFERENCES "public"."outbound_webhook_event" ("outbound_webhook_event_id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "outbound_webhook_delivery_redelivery_of_delivery_id_outbound_webhook_delivery_outbound_webhook_delivery_id_fk"
    FOREIGN KEY ("redelivery_of_delivery_id")
    REFERENCES "public"."outbound_webhook_delivery" ("outbound_webhook_delivery_id")
    ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "outbound_webhook_delivery_requested_by_user_id_user_user_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user" ("user_id")
    ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "outbound_webhook_delivery_status_check"
    CHECK ("status" IN ('pending', 'leased', 'retrying', 'succeeded', 'dead', 'suppressed')),
  CONSTRAINT "outbound_webhook_delivery_attempt_count_check"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "outbound_webhook_delivery_config_version_check"
    CHECK ("config_version" > 0)
);

CREATE TABLE IF NOT EXISTS "outbound_webhook_delivery_attempt" (
  "outbound_webhook_delivery_attempt_id" uuid PRIMARY KEY NOT NULL,
  "outbound_webhook_delivery_id" uuid NOT NULL,
  "attempt_number" integer NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "outcome" varchar(30),
  "http_status" integer,
  "error_code" varchar(100),
  "error_message" text,
  "response_body" text,
  "duration_ms" integer,
  "retry_after_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outbound_webhook_delivery_attempt_outbound_webhook_delivery_id_outbound_webhook_delivery_outbound_webhook_delivery_id_fk"
    FOREIGN KEY ("outbound_webhook_delivery_id")
    REFERENCES "public"."outbound_webhook_delivery" ("outbound_webhook_delivery_id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "outbound_webhook_delivery_attempt_number_check"
    CHECK ("attempt_number" > 0),
  CONSTRAINT "outbound_webhook_delivery_attempt_outcome_check"
    CHECK ("outcome" IS NULL OR "outcome" IN ('succeeded', 'http_error', 'network_error', 'timeout', 'internal_error', 'suppressed')),
  CONSTRAINT "outbound_webhook_delivery_attempt_http_status_check"
    CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599),
  CONSTRAINT "outbound_webhook_delivery_attempt_duration_check"
    CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
  CONSTRAINT "outbound_webhook_delivery_attempt_retry_after_check"
    CHECK ("retry_after_ms" IS NULL OR "retry_after_ms" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "outbound_webhook_secret_hash_uidx"
  ON "outbound_webhook" ("secret_hash");
CREATE INDEX IF NOT EXISTS "outbound_webhook_account_id_idx"
  ON "outbound_webhook" ("account_id");
CREATE INDEX IF NOT EXISTS "outbound_webhook_account_deleted_created_idx"
  ON "outbound_webhook" ("account_id", "deleted_at", "created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "outbound_webhook_active_account_idx"
  ON "outbound_webhook" ("account_id", "updated_at" DESC NULLS LAST)
  WHERE "deleted_at" IS NULL AND "status" = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS "outbound_webhook_subscription_webhook_event_uidx"
  ON "outbound_webhook_subscription" ("outbound_webhook_id", "event_type");
CREATE INDEX IF NOT EXISTS "outbound_webhook_subscription_webhook_id_idx"
  ON "outbound_webhook_subscription" ("outbound_webhook_id");
CREATE INDEX IF NOT EXISTS "outbound_webhook_subscription_active_event_idx"
  ON "outbound_webhook_subscription" ("event_type", "outbound_webhook_id")
  WHERE "active" = TRUE AND "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "outbound_webhook_event_account_created_idx"
  ON "outbound_webhook_event" (
    "account_id",
    "created_at" DESC NULLS LAST,
    "outbound_webhook_event_id" DESC NULLS LAST
  );
CREATE INDEX IF NOT EXISTS "outbound_webhook_event_state_created_idx"
  ON "outbound_webhook_event" ("state", "created_at");
CREATE INDEX IF NOT EXISTS "outbound_webhook_event_expires_at_idx"
  ON "outbound_webhook_event" ("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_webhook_event_idempotency_uidx"
  ON "outbound_webhook_event" ("account_id", "event_type", "idempotency_key");

CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_webhook_created_idx"
  ON "outbound_webhook_delivery" (
    "outbound_webhook_id",
    "created_at" DESC NULLS LAST,
    "outbound_webhook_delivery_id" DESC NULLS LAST
  );
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_event_id_idx"
  ON "outbound_webhook_delivery" ("outbound_webhook_event_id");
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_claim_idx"
  ON "outbound_webhook_delivery" ("next_attempt_at", "created_at")
  WHERE "status" IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_lease_expires_idx"
  ON "outbound_webhook_delivery" ("lease_expires_at")
  WHERE "status" = 'leased';
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_verification_idx"
  ON "outbound_webhook_delivery" (
    "outbound_webhook_id",
    "config_version",
    "delivered_at" DESC NULLS LAST
  )
  WHERE "status" = 'succeeded';
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_redelivery_of_idx"
  ON "outbound_webhook_delivery" ("redelivery_of_delivery_id");
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_requested_by_user_idx"
  ON "outbound_webhook_delivery" ("requested_by_user_id");
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_expires_at_idx"
  ON "outbound_webhook_delivery" ("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_webhook_delivery_initial_uidx"
  ON "outbound_webhook_delivery" ("outbound_webhook_id", "outbound_webhook_event_id")
  WHERE "redelivery_of_delivery_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "outbound_webhook_delivery_attempt_number_uidx"
  ON "outbound_webhook_delivery_attempt" ("outbound_webhook_delivery_id", "attempt_number");
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_attempt_delivery_created_idx"
  ON "outbound_webhook_delivery_attempt" ("outbound_webhook_delivery_id", "created_at");
CREATE INDEX IF NOT EXISTS "outbound_webhook_delivery_attempt_created_at_idx"
  ON "outbound_webhook_delivery_attempt" ("created_at");
