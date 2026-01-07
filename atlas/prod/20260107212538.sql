-- Create index "account_account_status_id_created_at_idx" to table: "account"
CREATE INDEX "account_account_status_id_created_at_idx" ON "account" ("account_status_id", "created_at");
-- Create index "account_deleted_at_created_at_idx" to table: "account"
CREATE INDEX "account_deleted_at_created_at_idx" ON "account" ("deleted_at", "created_at");
-- Create index "account_info_account_id_deleted_at_idx" to table: "account_info"
CREATE INDEX "account_info_account_id_deleted_at_idx" ON "account_info" ("account_id", "deleted_at");
-- Create index "account_payment_payment_billing_type_id_payment_status_id_creat" to table: "account_payment"
CREATE INDEX "account_payment_payment_billing_type_id_payment_status_id_creat" ON "account_payment" ("payment_billing_type_id", "payment_status_id", "created_at");
-- Create index "account_payment_payment_status_id_created_at_idx" to table: "account_payment"
CREATE INDEX "account_payment_payment_status_id_created_at_idx" ON "account_payment" ("payment_status_id", "created_at");
-- Create index "account_payment_plan_id_payment_status_id_created_at_idx" to table: "account_payment"
CREATE INDEX "account_payment_plan_id_payment_status_id_created_at_idx" ON "account_payment" ("plan_id", "payment_status_id", "created_at");
-- Create index "ai_agent_account_id_status_idx" to table: "ai_agent"
CREATE INDEX "ai_agent_account_id_status_idx" ON "ai_agent" ("account_id", "status");
-- Create index "ai_agent_prompt_ai_agent_id_status_idx" to table: "ai_agent_prompt"
CREATE INDEX "ai_agent_prompt_ai_agent_id_status_idx" ON "ai_agent_prompt" ("ai_agent_id", "status");
-- Create index "api_key_account_id_deleted_at_idx" to table: "api_key"
CREATE INDEX "api_key_account_id_deleted_at_idx" ON "api_key" ("account_id", "deleted_at");
-- Create index "api_key_key_deleted_at_idx" to table: "api_key"
CREATE INDEX "api_key_key_deleted_at_idx" ON "api_key" ("key", "deleted_at");
-- Create index "chatbot_name_idx" to table: "chatbot"
CREATE INDEX "chatbot_name_idx" ON "chatbot" ("name");
-- Create index "contact_account_id_deleted_at_created_at_idx" to table: "contact"
CREATE INDEX "contact_account_id_deleted_at_created_at_idx" ON "contact" ("account_id", "deleted_at", "created_at");
-- Create index "expenditure_created_at_idx" to table: "expenditure"
CREATE INDEX "expenditure_created_at_idx" ON "expenditure" ("created_at");
-- Create index "expenditure_deleted_at_created_at_idx" to table: "expenditure"
CREATE INDEX "expenditure_deleted_at_created_at_idx" ON "expenditure" ("deleted_at", "created_at");
-- Create index "notifications_notification_type_id_deleted_at_idx" to table: "notifications"
CREATE INDEX "notifications_notification_type_id_deleted_at_idx" ON "notifications" ("notification_type_id", "deleted_at");
-- Create index "notifications_worker_id_deleted_at_idx" to table: "notifications"
CREATE INDEX "notifications_worker_id_deleted_at_idx" ON "notifications" ("worker_id", "deleted_at");
-- Create index "permission_assignment_account_id_permission_role_id_idx" to table: "permission_assignment"
CREATE INDEX "permission_assignment_account_id_permission_role_id_idx" ON "permission_assignment" ("account_id", "permission_role_id");
-- Create index "permission_assignment_user_id_permission_role_id_idx" to table: "permission_assignment"
CREATE INDEX "permission_assignment_user_id_permission_role_id_idx" ON "permission_assignment" ("user_id", "permission_role_id");
-- Create index "permission_role_account_id_deleted_at_idx" to table: "permission_role"
CREATE INDEX "permission_role_account_id_deleted_at_idx" ON "permission_role" ("account_id", "deleted_at");
-- Create index "permission_role_name_idx" to table: "permission_role"
CREATE INDEX "permission_role_name_idx" ON "permission_role" ("name");
-- Create index "permission_role_action_permission_role_id_permission_action_gro" to table: "permission_role_action"
CREATE INDEX "permission_role_action_permission_role_id_permission_action_gro" ON "permission_role_action" ("permission_role_id", "permission_action_group_id");
-- Create index "plan_deleted_at_is_exclusive_idx" to table: "plan"
CREATE INDEX "plan_deleted_at_is_exclusive_idx" ON "plan" ("deleted_at", "is_exclusive");
-- Create index "plan_deleted_at_status_is_exclusive_idx" to table: "plan"
CREATE INDEX "plan_deleted_at_status_is_exclusive_idx" ON "plan" ("deleted_at", "status", "is_exclusive");
-- Create index "plan_is_test_idx" to table: "plan"
CREATE INDEX "plan_is_test_idx" ON "plan" ("is_test");
-- Create index "plan_account_exclusive_account_id_plan_id_idx" to table: "plan_account_exclusive"
CREATE INDEX "plan_account_exclusive_account_id_plan_id_idx" ON "plan_account_exclusive" ("account_id", "plan_id");
-- Create index "push_subscription_user_id_deleted_at_idx" to table: "push_subscription"
CREATE INDEX "push_subscription_user_id_deleted_at_idx" ON "push_subscription" ("user_id", "deleted_at");
-- Create index "report_conversation_history_pdf_account_id_chat_id_idx" to table: "report_conversation_history_pdf"
CREATE INDEX "report_conversation_history_pdf_account_id_chat_id_idx" ON "report_conversation_history_pdf" ("account_id", "chat_id");
-- Create index "report_conversation_history_pdf_account_id_status_idx" to table: "report_conversation_history_pdf"
CREATE INDEX "report_conversation_history_pdf_account_id_status_idx" ON "report_conversation_history_pdf" ("account_id", "status");
-- Create index "schedule_status_send_date_created_at_idx" to table: "schedule"
CREATE INDEX "schedule_status_send_date_created_at_idx" ON "schedule" ("status", "send_date", "created_at");
-- Create index "server_deleted_at_server_status_id_idx" to table: "server"
CREATE INDEX "server_deleted_at_server_status_id_idx" ON "server" ("deleted_at", "server_status_id");
-- Create index "server_ssh_server_id_deleted_at_idx" to table: "server_ssh"
CREATE INDEX "server_ssh_server_id_deleted_at_idx" ON "server_ssh" ("server_id", "deleted_at");
-- Create index "server_ssh_ssh_ip_idx" to table: "server_ssh"
CREATE INDEX "server_ssh_ssh_ip_idx" ON "server_ssh" ("ssh_ip");
-- Create index "server_web_server_id_deleted_at_idx" to table: "server_web"
CREATE INDEX "server_web_server_id_deleted_at_idx" ON "server_web" ("server_id", "deleted_at");
-- Create index "server_web_web_domain_idx" to table: "server_web"
CREATE INDEX "server_web_web_domain_idx" ON "server_web" ("web_domain");
-- Create index "user_account_id_deleted_at_created_at_idx" to table: "user"
CREATE INDEX "user_account_id_deleted_at_created_at_idx" ON "user" ("account_id", "deleted_at", "created_at");
-- Create index "user_email_c_user_status_id_deleted_at_idx" to table: "user"
CREATE INDEX "user_email_c_user_status_id_deleted_at_idx" ON "user" ("email_c", "user_status_id", "deleted_at");
-- Create index "user_user_id_account_id_user_status_id_deleted_at_idx" to table: "user"
CREATE INDEX "user_user_id_account_id_user_status_id_deleted_at_idx" ON "user" ("user_id", "account_id", "user_status_id", "deleted_at");
-- Create index "user_user_id_deleted_at_idx" to table: "user"
CREATE INDEX "user_user_id_deleted_at_idx" ON "user" ("user_id", "deleted_at");
-- Create index "worker_account_id_deleted_at_created_at_idx" to table: "worker"
CREATE INDEX "worker_account_id_deleted_at_created_at_idx" ON "worker" ("account_id", "deleted_at", "created_at");
-- Create index "worker_config_worker_id_chatbot_id_idx" to table: "worker_config"
CREATE INDEX "worker_config_worker_id_chatbot_id_idx" ON "worker_config" ("worker_id", "chatbot_id");
-- Create index "worker_config_worker_id_worker_config_type_id_idx" to table: "worker_config"
CREATE INDEX "worker_config_worker_id_worker_config_type_id_idx" ON "worker_config" ("worker_id", "worker_config_type_id");
