CREATE TABLE IF NOT EXISTS "chatbot_holiday" (
  "chatbot_holiday_id" uuid PRIMARY KEY NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "account" ("account_id"),
  "scope" character varying(20) NOT NULL,
  "name" character varying(250) NOT NULL,
  "month" smallint NOT NULL,
  "day" smallint NOT NULL,
  "state_id" uuid NULL REFERENCES "zipcode_state" ("id_zipcode_state"),
  "city_id" uuid NULL REFERENCES "zipcode_city" ("id_zipcode_city"),
  "created_at" timestamptz NULL DEFAULT NOW(),
  "updated_at" timestamptz NULL DEFAULT NOW(),
  CONSTRAINT "chatbot_holiday_scope_check"
    CHECK ("scope" IN ('state', 'municipal')),
  CONSTRAINT "chatbot_holiday_month_check"
    CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "chatbot_holiday_day_check"
    CHECK ("day" BETWEEN 1 AND 31)
);

CREATE INDEX IF NOT EXISTS "chatbot_holiday_account_id_idx"
  ON "chatbot_holiday" ("account_id");

CREATE INDEX IF NOT EXISTS "chatbot_holiday_scope_idx"
  ON "chatbot_holiday" ("scope");

CREATE INDEX IF NOT EXISTS "chatbot_holiday_month_day_idx"
  ON "chatbot_holiday" ("month", "day");

CREATE INDEX IF NOT EXISTS "chatbot_holiday_state_id_idx"
  ON "chatbot_holiday" ("state_id");

CREATE INDEX IF NOT EXISTS "chatbot_holiday_city_id_idx"
  ON "chatbot_holiday" ("city_id");
