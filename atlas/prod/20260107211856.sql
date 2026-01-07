-- Create index "contact_account_id_deleted_at_idx" to table: "contact"
CREATE INDEX "contact_account_id_deleted_at_idx" ON "contact" ("account_id", "deleted_at");
-- Create index "contact_account_id_email_c_deleted_at_idx" to table: "contact"
CREATE INDEX "contact_account_id_email_c_deleted_at_idx" ON "contact" ("account_id", "email_c", "deleted_at");
-- Create index "contact_account_id_is_valided_deleted_at_idx" to table: "contact"
CREATE INDEX "contact_account_id_is_valided_deleted_at_idx" ON "contact" ("account_id", "is_valided", "deleted_at");
-- Create index "contact_account_id_phone_c_deleted_at_idx" to table: "contact"
CREATE INDEX "contact_account_id_phone_c_deleted_at_idx" ON "contact" ("account_id", "phone_c", "deleted_at");
-- Create index "contact_group_account_id_deleted_at_idx" to table: "contact_group"
CREATE INDEX "contact_group_account_id_deleted_at_idx" ON "contact_group" ("account_id", "deleted_at");
-- Create index "contact_group_assignment_contact_group_id_contact_id_idx" to table: "contact_group_assignment"
CREATE INDEX "contact_group_assignment_contact_group_id_contact_id_idx" ON "contact_group_assignment" ("contact_group_id", "contact_id");
-- Create index "label_template_account_id_deleted_at_idx" to table: "label_template"
CREATE INDEX "label_template_account_id_deleted_at_idx" ON "label_template" ("account_id", "deleted_at");
-- Create index "message_template_account_id_deleted_at_idx" to table: "message_template"
CREATE INDEX "message_template_account_id_deleted_at_idx" ON "message_template" ("account_id", "deleted_at");
-- Create index "plan_deleted_at_status_idx" to table: "plan"
CREATE INDEX "plan_deleted_at_status_idx" ON "plan" ("deleted_at", "status");
-- Create index "plan_account_account_id_cancellation_date_idx" to table: "plan_account"
CREATE INDEX "plan_account_account_id_cancellation_date_idx" ON "plan_account" ("account_id", "cancellation_date");
-- Create index "plan_account_account_id_next_payment_date_cancellation_date_idx" to table: "plan_account"
CREATE INDEX "plan_account_account_id_next_payment_date_cancellation_date_idx" ON "plan_account" ("account_id", "next_payment_date", "cancellation_date");
-- Create index "plan_account_account_id_next_payment_date_idx" to table: "plan_account"
CREATE INDEX "plan_account_account_id_next_payment_date_idx" ON "plan_account" ("account_id", "next_payment_date");
-- Create index "plan_account_recurring_payment_cancellation_date_next_payment_d" to table: "plan_account"
CREATE INDEX "plan_account_recurring_payment_cancellation_date_next_payment_d" ON "plan_account" ("recurring_payment", "cancellation_date", "next_payment_date");
-- Create index "plan_cross_sell_account_account_id_deleted_at_idx" to table: "plan_cross_sell_account"
CREATE INDEX "plan_cross_sell_account_account_id_deleted_at_idx" ON "plan_cross_sell_account" ("account_id", "deleted_at");
-- Create index "plan_items_plan_id_deleted_at_idx" to table: "plan_items"
CREATE INDEX "plan_items_plan_id_deleted_at_idx" ON "plan_items" ("plan_id", "deleted_at");
-- Create index "schedule_account_id_status_idx" to table: "schedule"
CREATE INDEX "schedule_account_id_status_idx" ON "schedule" ("account_id", "status");
-- Create index "schedule_status_send_date_idx" to table: "schedule"
CREATE INDEX "schedule_status_send_date_idx" ON "schedule" ("status", "send_date");
-- Create index "scheduled_contact_schedule_id_contact_id_idx" to table: "scheduled_contact"
CREATE INDEX "scheduled_contact_schedule_id_contact_id_idx" ON "scheduled_contact" ("schedule_id", "contact_id");
-- Create index "sector_account_id_deleted_at_idx" to table: "sector"
CREATE INDEX "sector_account_id_deleted_at_idx" ON "sector" ("account_id", "deleted_at");
-- Create index "sector_user_sector_id_user_id_idx" to table: "sector_user"
CREATE INDEX "sector_user_sector_id_user_id_idx" ON "sector_user" ("sector_id", "user_id");
-- Create index "sector_user_user_id_deleted_at_idx" to table: "sector_user"
CREATE INDEX "sector_user_user_id_deleted_at_idx" ON "sector_user" ("user_id", "deleted_at");
-- Create index "two_factor_email_c_phone_c_code_deleted_at_idx" to table: "two_factor"
CREATE INDEX "two_factor_email_c_phone_c_code_deleted_at_idx" ON "two_factor" ("email_c", "phone_c", "code", "deleted_at");
-- Create index "two_factor_email_c_phone_c_token_idx" to table: "two_factor"
CREATE INDEX "two_factor_email_c_phone_c_token_idx" ON "two_factor" ("email_c", "phone_c", "token");
-- Create index "user_account_id_deleted_at_idx" to table: "user"
CREATE INDEX "user_account_id_deleted_at_idx" ON "user" ("account_id", "deleted_at");
-- Create index "user_account_id_user_status_id_deleted_at_idx" to table: "user"
CREATE INDEX "user_account_id_user_status_id_deleted_at_idx" ON "user" ("account_id", "user_status_id", "deleted_at");
-- Create index "user_email_c_deleted_at_idx" to table: "user"
CREATE INDEX "user_email_c_deleted_at_idx" ON "user" ("email_c", "deleted_at");
-- Create index "user_address_user_id_deleted_at_idx" to table: "user_address"
CREATE INDEX "user_address_user_id_deleted_at_idx" ON "user_address" ("user_id", "deleted_at");
-- Create index "user_card_user_id_default_idx" to table: "user_card"
CREATE INDEX "user_card_user_id_default_idx" ON "user_card" ("user_id", "default");
-- Create index "user_card_user_id_deleted_at_idx" to table: "user_card"
CREATE INDEX "user_card_user_id_deleted_at_idx" ON "user_card" ("user_id", "deleted_at");
-- Create index "user_document_document_c_idx" to table: "user_document"
CREATE INDEX "user_document_document_c_idx" ON "user_document" ("document_c");
-- Create index "user_document_user_id_user_document_type_id_idx" to table: "user_document"
CREATE INDEX "user_document_user_id_user_document_type_id_idx" ON "user_document" ("user_id", "user_document_type_id");
-- Create index "user_info_phone_c_deleted_at_idx" to table: "user_info"
CREATE INDEX "user_info_phone_c_deleted_at_idx" ON "user_info" ("phone_c", "deleted_at");
-- Create index "user_info_user_id_deleted_at_idx" to table: "user_info"
CREATE INDEX "user_info_user_id_deleted_at_idx" ON "user_info" ("user_id", "deleted_at");
-- Create index "worker_account_id_deleted_at_idx" to table: "worker"
CREATE INDEX "worker_account_id_deleted_at_idx" ON "worker" ("account_id", "deleted_at");
