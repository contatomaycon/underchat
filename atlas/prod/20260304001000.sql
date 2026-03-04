-- Add mobile push provider support to push subscriptions
ALTER TABLE "push_subscription"
  ADD COLUMN "provider" character varying(20) NOT NULL DEFAULT 'webpush',
  ADD COLUMN "platform" character varying(20);

ALTER TABLE "push_subscription"
  ALTER COLUMN "p256dh" DROP NOT NULL,
  ALTER COLUMN "auth" DROP NOT NULL;
