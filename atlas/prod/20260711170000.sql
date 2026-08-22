-- Preserve the authoritative ordering of payment status webhooks. This keeps a
-- delayed CONFIRMED/RECEIVED event from rematerializing access after a newer
-- refund or chargeback event.
ALTER TABLE "account_payment"
  ADD COLUMN "payment_status_observed_at" timestamp with time zone NULL,
  ADD COLUMN "payment_status_event_id" character varying(255) NULL;
