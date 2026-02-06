CREATE TABLE "contact_channel" (
	"contact_channel_id" uuid PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "contact_channel" ADD CONSTRAINT "contact_channel_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("contact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channel" ADD CONSTRAINT "contact_channel_channel_id_worker_worker_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channel" ADD CONSTRAINT "contact_channel_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_channel_contact_id_idx" ON "contact_channel" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_channel_channel_id_idx" ON "contact_channel" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "contact_channel_account_id_idx" ON "contact_channel" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contact_channel_contact_id_channel_id_idx" ON "contact_channel" USING btree ("contact_id","channel_id");--> statement-breakpoint
CREATE INDEX "contact_channel_contact_id_account_id_idx" ON "contact_channel" USING btree ("contact_id","account_id");--> statement-breakpoint
CREATE INDEX "contact_channel_account_id_channel_id_idx" ON "contact_channel" USING btree ("account_id","channel_id");