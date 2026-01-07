-- Create index "account_account_status_id_idx" to table: "account"
CREATE INDEX "account_account_status_id_idx" ON "account" ("account_status_id");
-- Create index "account_deleted_at_idx" to table: "account"
CREATE INDEX "account_deleted_at_idx" ON "account" ("deleted_at");
-- Create index "account_info_account_id_idx" to table: "account_info"
CREATE INDEX "account_info_account_id_idx" ON "account_info" ("account_id");
-- Create index "account_info_deleted_at_idx" to table: "account_info"
CREATE INDEX "account_info_deleted_at_idx" ON "account_info" ("deleted_at");
-- Create index "account_payment_account_id_idx" to table: "account_payment"
CREATE INDEX "account_payment_account_id_idx" ON "account_payment" ("account_id");
-- Create index "account_payment_payment_billing_type_id_idx" to table: "account_payment"
CREATE INDEX "account_payment_payment_billing_type_id_idx" ON "account_payment" ("payment_billing_type_id");
-- Create index "account_payment_payment_date_idx" to table: "account_payment"
CREATE INDEX "account_payment_payment_date_idx" ON "account_payment" ("payment_date");
-- Create index "account_payment_payment_status_id_idx" to table: "account_payment"
CREATE INDEX "account_payment_payment_status_id_idx" ON "account_payment" ("payment_status_id");
-- Create index "account_payment_plan_id_idx" to table: "account_payment"
CREATE INDEX "account_payment_plan_id_idx" ON "account_payment" ("plan_id");
-- Create index "account_payment_user_customer_id_idx" to table: "account_payment"
CREATE INDEX "account_payment_user_customer_id_idx" ON "account_payment" ("user_customer_id");
-- Create index "account_payment_cross_sell_account_payment_id_idx" to table: "account_payment_cross_sell"
CREATE INDEX "account_payment_cross_sell_account_payment_id_idx" ON "account_payment_cross_sell" ("account_payment_id");
-- Create index "account_payment_cross_sell_plan_cross_sell_id_idx" to table: "account_payment_cross_sell"
CREATE INDEX "account_payment_cross_sell_plan_cross_sell_id_idx" ON "account_payment_cross_sell" ("plan_cross_sell_id");
-- Create index "account_payment_nfse_account_payment_id_idx" to table: "account_payment_nfse"
CREATE INDEX "account_payment_nfse_account_payment_id_idx" ON "account_payment_nfse" ("account_payment_id");
-- Create index "account_payment_nfse_account_payment_nfse_status_id_idx" to table: "account_payment_nfse"
CREATE INDEX "account_payment_nfse_account_payment_nfse_status_id_idx" ON "account_payment_nfse" ("account_payment_nfse_status_id");
-- Create index "account_payment_nfse_nfse_id_idx" to table: "account_payment_nfse"
CREATE INDEX "account_payment_nfse_nfse_id_idx" ON "account_payment_nfse" ("nfse_id");
-- Create index "account_payment_nfse_status_name_idx" to table: "account_payment_nfse_status"
CREATE INDEX "account_payment_nfse_status_name_idx" ON "account_payment_nfse_status" ("name");
-- Create index "account_status_name_idx" to table: "account_status"
CREATE INDEX "account_status_name_idx" ON "account_status" ("name");
-- Create index "account_test_document_idx" to table: "account_test"
CREATE INDEX "account_test_document_idx" ON "account_test" ("document");
-- Create index "account_test_email_idx" to table: "account_test"
CREATE INDEX "account_test_email_idx" ON "account_test" ("email");
-- Create index "account_test_phone_idx" to table: "account_test"
CREATE INDEX "account_test_phone_idx" ON "account_test" ("phone");
-- Create index "ai_agent_account_id_idx" to table: "ai_agent"
CREATE INDEX "ai_agent_account_id_idx" ON "ai_agent" ("account_id");
-- Create index "ai_agent_ai_agent_type_id_idx" to table: "ai_agent"
CREATE INDEX "ai_agent_ai_agent_type_id_idx" ON "ai_agent" ("ai_agent_type_id");
-- Create index "ai_agent_status_idx" to table: "ai_agent"
CREATE INDEX "ai_agent_status_idx" ON "ai_agent" ("status");
-- Create index "ai_agent_prompt_ai_agent_id_idx" to table: "ai_agent_prompt"
CREATE INDEX "ai_agent_prompt_ai_agent_id_idx" ON "ai_agent_prompt" ("ai_agent_id");
-- Create index "ai_agent_prompt_status_idx" to table: "ai_agent_prompt"
CREATE INDEX "ai_agent_prompt_status_idx" ON "ai_agent_prompt" ("status");
-- Create index "ai_agent_type_name_idx" to table: "ai_agent_type"
CREATE INDEX "ai_agent_type_name_idx" ON "ai_agent_type" ("name");
-- Create index "api_key_account_id_idx" to table: "api_key"
CREATE INDEX "api_key_account_id_idx" ON "api_key" ("account_id");
-- Create index "api_key_deleted_at_idx" to table: "api_key"
CREATE INDEX "api_key_deleted_at_idx" ON "api_key" ("deleted_at");
-- Create index "api_key_key_idx" to table: "api_key"
CREATE INDEX "api_key_key_idx" ON "api_key" ("key");
-- Create index "billing_period_name_idx" to table: "billing_period"
CREATE INDEX "billing_period_name_idx" ON "billing_period" ("name");
-- Create index "chat_user_user_id_idx" to table: "chat_user"
CREATE INDEX "chat_user_user_id_idx" ON "chat_user" ("user_id");
-- Create index "chatbot_account_id_idx" to table: "chatbot"
CREATE INDEX "chatbot_account_id_idx" ON "chatbot" ("account_id");
-- Create index "contact_account_id_idx" to table: "contact"
CREATE INDEX "contact_account_id_idx" ON "contact" ("account_id");
-- Create index "contact_contact_document_type_id_idx" to table: "contact"
CREATE INDEX "contact_contact_document_type_id_idx" ON "contact" ("contact_document_type_id");
-- Create index "contact_deleted_at_idx" to table: "contact"
CREATE INDEX "contact_deleted_at_idx" ON "contact" ("deleted_at");
-- Create index "contact_document_partial_idx" to table: "contact"
CREATE INDEX "contact_document_partial_idx" ON "contact" ("document_partial");
-- Create index "contact_email_partial_idx" to table: "contact"
CREATE INDEX "contact_email_partial_idx" ON "contact" ("email_partial");
-- Create index "contact_label_template_id_idx" to table: "contact"
CREATE INDEX "contact_label_template_id_idx" ON "contact" ("label_template_id");
-- Create index "contact_phone_partial_idx" to table: "contact"
CREATE INDEX "contact_phone_partial_idx" ON "contact" ("phone_partial");
-- Create index "contact_document_type_name_idx" to table: "contact_document_type"
CREATE INDEX "contact_document_type_name_idx" ON "contact_document_type" ("name");
-- Create index "contact_group_account_id_idx" to table: "contact_group"
CREATE INDEX "contact_group_account_id_idx" ON "contact_group" ("account_id");
-- Create index "contact_group_deleted_at_idx" to table: "contact_group"
CREATE INDEX "contact_group_deleted_at_idx" ON "contact_group" ("deleted_at");
-- Create index "contact_group_assignment_contact_group_id_idx" to table: "contact_group_assignment"
CREATE INDEX "contact_group_assignment_contact_group_id_idx" ON "contact_group_assignment" ("contact_group_id");
-- Create index "contact_group_assignment_contact_id_idx" to table: "contact_group_assignment"
CREATE INDEX "contact_group_assignment_contact_id_idx" ON "contact_group_assignment" ("contact_id");
-- Create index "country_iso_code_idx" to table: "country"
CREATE INDEX "country_iso_code_idx" ON "country" ("iso_code");
-- Create index "credit_card_fee_deleted_at_idx" to table: "credit_card_fee"
CREATE INDEX "credit_card_fee_deleted_at_idx" ON "credit_card_fee" ("deleted_at");
-- Create index "expenditure_deleted_at_idx" to table: "expenditure"
CREATE INDEX "expenditure_deleted_at_idx" ON "expenditure" ("deleted_at");
-- Create index "label_status_name_idx" to table: "label_status"
CREATE INDEX "label_status_name_idx" ON "label_status" ("name");
-- Create index "label_template_account_id_idx" to table: "label_template"
CREATE INDEX "label_template_account_id_idx" ON "label_template" ("account_id");
-- Create index "label_template_deleted_at_idx" to table: "label_template"
CREATE INDEX "label_template_deleted_at_idx" ON "label_template" ("deleted_at");
-- Create index "label_template_label_status_id_idx" to table: "label_template"
CREATE INDEX "label_template_label_status_id_idx" ON "label_template" ("label_status_id");
-- Create index "message_status_name_idx" to table: "message_status"
CREATE INDEX "message_status_name_idx" ON "message_status" ("name");
-- Create index "message_template_account_id_idx" to table: "message_template"
CREATE INDEX "message_template_account_id_idx" ON "message_template" ("account_id");
-- Create index "message_template_command_idx" to table: "message_template"
CREATE INDEX "message_template_command_idx" ON "message_template" ("command");
-- Create index "message_template_deleted_at_idx" to table: "message_template"
CREATE INDEX "message_template_deleted_at_idx" ON "message_template" ("deleted_at");
-- Create index "message_template_message_status_id_idx" to table: "message_template"
CREATE INDEX "message_template_message_status_id_idx" ON "message_template" ("message_status_id");
-- Create index "nfse_default_product_idx" to table: "nfse"
CREATE INDEX "nfse_default_product_idx" ON "nfse" ("default_product");
-- Create index "nfse_external_id_idx" to table: "nfse"
CREATE INDEX "nfse_external_id_idx" ON "nfse" ("external_id");
-- Create index "notification_type_name_idx" to table: "notification_type"
CREATE INDEX "notification_type_name_idx" ON "notification_type" ("name");
-- Create index "notifications_deleted_at_idx" to table: "notifications"
CREATE INDEX "notifications_deleted_at_idx" ON "notifications" ("deleted_at");
-- Create index "notifications_notification_type_id_idx" to table: "notifications"
CREATE INDEX "notifications_notification_type_id_idx" ON "notifications" ("notification_type_id");
-- Create index "notifications_worker_id_idx" to table: "notifications"
CREATE INDEX "notifications_worker_id_idx" ON "notifications" ("worker_id");
-- Create index "payment_billing_type_name_idx" to table: "payment_billing_type"
CREATE INDEX "payment_billing_type_name_idx" ON "payment_billing_type" ("name");
-- Create index "payment_status_name_idx" to table: "payment_status"
CREATE INDEX "payment_status_name_idx" ON "payment_status" ("name");
-- Create index "permission_action_permission_action_group_id_idx" to table: "permission_action"
CREATE INDEX "permission_action_permission_action_group_id_idx" ON "permission_action" ("permission_action_group_id");
-- Create index "permission_action_permission_module_id_idx" to table: "permission_action"
CREATE INDEX "permission_action_permission_module_id_idx" ON "permission_action" ("permission_module_id");
-- Create index "permission_action_groups_action_idx" to table: "permission_action_groups"
CREATE INDEX "permission_action_groups_action_idx" ON "permission_action_groups" ("action");
-- Create index "permission_action_groups_name_idx" to table: "permission_action_groups"
CREATE INDEX "permission_action_groups_name_idx" ON "permission_action_groups" ("name");
-- Create index "permission_assignment_account_id_idx" to table: "permission_assignment"
CREATE INDEX "permission_assignment_account_id_idx" ON "permission_assignment" ("account_id");
-- Create index "permission_assignment_permission_role_id_idx" to table: "permission_assignment"
CREATE INDEX "permission_assignment_permission_role_id_idx" ON "permission_assignment" ("permission_role_id");
-- Create index "permission_assignment_user_id_idx" to table: "permission_assignment"
CREATE INDEX "permission_assignment_user_id_idx" ON "permission_assignment" ("user_id");
-- Create index "permission_module_module_idx" to table: "permission_module"
CREATE INDEX "permission_module_module_idx" ON "permission_module" ("module");
-- Create index "permission_role_account_id_idx" to table: "permission_role"
CREATE INDEX "permission_role_account_id_idx" ON "permission_role" ("account_id");
-- Create index "permission_role_deleted_at_idx" to table: "permission_role"
CREATE INDEX "permission_role_deleted_at_idx" ON "permission_role" ("deleted_at");
-- Create index "permission_role_action_permission_action_group_id_idx" to table: "permission_role_action"
CREATE INDEX "permission_role_action_permission_action_group_id_idx" ON "permission_role_action" ("permission_action_group_id");
-- Create index "permission_role_action_permission_action_id_idx" to table: "permission_role_action"
CREATE INDEX "permission_role_action_permission_action_id_idx" ON "permission_role_action" ("permission_action_id");
-- Create index "permission_role_action_permission_role_id_idx" to table: "permission_role_action"
CREATE INDEX "permission_role_action_permission_role_id_idx" ON "permission_role_action" ("permission_role_id");
-- Create index "plan_deleted_at_idx" to table: "plan"
CREATE INDEX "plan_deleted_at_idx" ON "plan" ("deleted_at");
-- Create index "plan_status_idx" to table: "plan"
CREATE INDEX "plan_status_idx" ON "plan" ("status");
-- Create index "plan_account_account_id_idx" to table: "plan_account"
CREATE INDEX "plan_account_account_id_idx" ON "plan_account" ("account_id");
-- Create index "plan_account_account_payment_id_idx" to table: "plan_account"
CREATE INDEX "plan_account_account_payment_id_idx" ON "plan_account" ("account_payment_id");
-- Create index "plan_account_billing_period_id_idx" to table: "plan_account"
CREATE INDEX "plan_account_billing_period_id_idx" ON "plan_account" ("billing_period_id");
-- Create index "plan_account_next_payment_date_idx" to table: "plan_account"
CREATE INDEX "plan_account_next_payment_date_idx" ON "plan_account" ("next_payment_date");
-- Create index "plan_account_plan_id_idx" to table: "plan_account"
CREATE INDEX "plan_account_plan_id_idx" ON "plan_account" ("plan_id");
-- Create index "plan_account_exclusive_account_id_idx" to table: "plan_account_exclusive"
CREATE INDEX "plan_account_exclusive_account_id_idx" ON "plan_account_exclusive" ("account_id");
-- Create index "plan_account_exclusive_plan_id_idx" to table: "plan_account_exclusive"
CREATE INDEX "plan_account_exclusive_plan_id_idx" ON "plan_account_exclusive" ("plan_id");
-- Create index "plan_cross_sell_deleted_at_idx" to table: "plan_cross_sell"
CREATE INDEX "plan_cross_sell_deleted_at_idx" ON "plan_cross_sell" ("deleted_at");
-- Create index "plan_cross_sell_plan_product_id_idx" to table: "plan_cross_sell"
CREATE INDEX "plan_cross_sell_plan_product_id_idx" ON "plan_cross_sell" ("plan_product_id");
-- Create index "plan_cross_sell_account_account_id_idx" to table: "plan_cross_sell_account"
CREATE INDEX "plan_cross_sell_account_account_id_idx" ON "plan_cross_sell_account" ("account_id");
-- Create index "plan_cross_sell_account_deleted_at_idx" to table: "plan_cross_sell_account"
CREATE INDEX "plan_cross_sell_account_deleted_at_idx" ON "plan_cross_sell_account" ("deleted_at");
-- Create index "plan_cross_sell_account_plan_cross_sell_id_idx" to table: "plan_cross_sell_account"
CREATE INDEX "plan_cross_sell_account_plan_cross_sell_id_idx" ON "plan_cross_sell_account" ("plan_cross_sell_id");
-- Create index "plan_items_deleted_at_idx" to table: "plan_items"
CREATE INDEX "plan_items_deleted_at_idx" ON "plan_items" ("deleted_at");
-- Create index "plan_items_plan_id_idx" to table: "plan_items"
CREATE INDEX "plan_items_plan_id_idx" ON "plan_items" ("plan_id");
-- Create index "plan_items_plan_product_id_idx" to table: "plan_items"
CREATE INDEX "plan_items_plan_product_id_idx" ON "plan_items" ("plan_product_id");
-- Create index "plan_product_name_idx" to table: "plan_product"
CREATE INDEX "plan_product_name_idx" ON "plan_product" ("name");
-- Create index "plan_product_description_plan_product_id_idx" to table: "plan_product_description"
CREATE INDEX "plan_product_description_plan_product_id_idx" ON "plan_product_description" ("plan_product_id");
-- Create index "push_subscription_deleted_at_idx" to table: "push_subscription"
CREATE INDEX "push_subscription_deleted_at_idx" ON "push_subscription" ("deleted_at");
-- Create index "push_subscription_user_id_idx" to table: "push_subscription"
CREATE INDEX "push_subscription_user_id_idx" ON "push_subscription" ("user_id");
-- Create index "report_conversation_history_pdf_account_id_idx" to table: "report_conversation_history_pdf"
CREATE INDEX "report_conversation_history_pdf_account_id_idx" ON "report_conversation_history_pdf" ("account_id");
-- Create index "report_conversation_history_pdf_chat_id_idx" to table: "report_conversation_history_pdf"
CREATE INDEX "report_conversation_history_pdf_chat_id_idx" ON "report_conversation_history_pdf" ("chat_id");
-- Create index "report_conversation_history_pdf_status_idx" to table: "report_conversation_history_pdf"
CREATE INDEX "report_conversation_history_pdf_status_idx" ON "report_conversation_history_pdf" ("status");
-- Create index "schedule_account_id_idx" to table: "schedule"
CREATE INDEX "schedule_account_id_idx" ON "schedule" ("account_id");
-- Create index "schedule_send_date_idx" to table: "schedule"
CREATE INDEX "schedule_send_date_idx" ON "schedule" ("send_date");
-- Create index "schedule_status_idx" to table: "schedule"
CREATE INDEX "schedule_status_idx" ON "schedule" ("status");
-- Create index "schedule_worker_id_idx" to table: "schedule"
CREATE INDEX "schedule_worker_id_idx" ON "schedule" ("worker_id");
-- Create index "scheduled_contact_contact_group_id_idx" to table: "scheduled_contact"
CREATE INDEX "scheduled_contact_contact_group_id_idx" ON "scheduled_contact" ("contact_group_id");
-- Create index "scheduled_contact_contact_id_idx" to table: "scheduled_contact"
CREATE INDEX "scheduled_contact_contact_id_idx" ON "scheduled_contact" ("contact_id");
-- Create index "scheduled_contact_schedule_id_idx" to table: "scheduled_contact"
CREATE INDEX "scheduled_contact_schedule_id_idx" ON "scheduled_contact" ("schedule_id");
-- Create index "sector_account_id_idx" to table: "sector"
CREATE INDEX "sector_account_id_idx" ON "sector" ("account_id");
-- Create index "sector_deleted_at_idx" to table: "sector"
CREATE INDEX "sector_deleted_at_idx" ON "sector" ("deleted_at");
-- Create index "sector_sector_status_id_idx" to table: "sector"
CREATE INDEX "sector_sector_status_id_idx" ON "sector" ("sector_status_id");
-- Create index "sector_status_name_idx" to table: "sector_status"
CREATE INDEX "sector_status_name_idx" ON "sector_status" ("name");
-- Create index "sector_user_deleted_at_idx" to table: "sector_user"
CREATE INDEX "sector_user_deleted_at_idx" ON "sector_user" ("deleted_at");
-- Create index "sector_user_sector_id_idx" to table: "sector_user"
CREATE INDEX "sector_user_sector_id_idx" ON "sector_user" ("sector_id");
-- Create index "sector_user_user_id_idx" to table: "sector_user"
CREATE INDEX "sector_user_user_id_idx" ON "sector_user" ("user_id");
-- Create index "server_deleted_at_idx" to table: "server"
CREATE INDEX "server_deleted_at_idx" ON "server" ("deleted_at");
-- Create index "server_server_status_id_idx" to table: "server"
CREATE INDEX "server_server_status_id_idx" ON "server" ("server_status_id");
-- Create index "server_ssh_deleted_at_idx" to table: "server_ssh"
CREATE INDEX "server_ssh_deleted_at_idx" ON "server_ssh" ("deleted_at");
-- Create index "server_ssh_server_id_idx" to table: "server_ssh"
CREATE INDEX "server_ssh_server_id_idx" ON "server_ssh" ("server_id");
-- Create index "server_status_status_idx" to table: "server_status"
CREATE INDEX "server_status_status_idx" ON "server_status" ("status");
-- Create index "server_web_deleted_at_idx" to table: "server_web"
CREATE INDEX "server_web_deleted_at_idx" ON "server_web" ("deleted_at");
-- Create index "server_web_server_id_idx" to table: "server_web"
CREATE INDEX "server_web_server_id_idx" ON "server_web" ("server_id");
-- Create index "two_factor_code_idx" to table: "two_factor"
CREATE INDEX "two_factor_code_idx" ON "two_factor" ("code");
-- Create index "two_factor_deleted_at_idx" to table: "two_factor"
CREATE INDEX "two_factor_deleted_at_idx" ON "two_factor" ("deleted_at");
-- Create index "two_factor_token_idx" to table: "two_factor"
CREATE INDEX "two_factor_token_idx" ON "two_factor" ("token");
-- Create index "two_factor_user_id_idx" to table: "two_factor"
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" ("user_id");
-- Create index "user_account_id_idx" to table: "user"
CREATE INDEX "user_account_id_idx" ON "user" ("account_id");
-- Create index "user_deleted_at_idx" to table: "user"
CREATE INDEX "user_deleted_at_idx" ON "user" ("deleted_at");
-- Create index "user_email_idx" to table: "user"
CREATE INDEX "user_email_idx" ON "user" ("email");
-- Create index "user_email_partial_idx" to table: "user"
CREATE INDEX "user_email_partial_idx" ON "user" ("email_partial");
-- Create index "user_user_status_id_idx" to table: "user"
CREATE INDEX "user_user_status_id_idx" ON "user" ("user_status_id");
-- Create index "user_address_city_fiscal_code_idx" to table: "user_address"
CREATE INDEX "user_address_city_fiscal_code_idx" ON "user_address" ("city_fiscal_code");
-- Create index "user_address_country_id_idx" to table: "user_address"
CREATE INDEX "user_address_country_id_idx" ON "user_address" ("country_id");
-- Create index "user_address_deleted_at_idx" to table: "user_address"
CREATE INDEX "user_address_deleted_at_idx" ON "user_address" ("deleted_at");
-- Create index "user_address_state_fiscal_code_idx" to table: "user_address"
CREATE INDEX "user_address_state_fiscal_code_idx" ON "user_address" ("state_fiscal_code");
-- Create index "user_address_user_id_idx" to table: "user_address"
CREATE INDEX "user_address_user_id_idx" ON "user_address" ("user_id");
-- Create index "user_card_deleted_at_idx" to table: "user_card"
CREATE INDEX "user_card_deleted_at_idx" ON "user_card" ("deleted_at");
-- Create index "user_card_user_id_idx" to table: "user_card"
CREATE INDEX "user_card_user_id_idx" ON "user_card" ("user_id");
-- Create index "user_customer_user_id_idx" to table: "user_customer"
CREATE INDEX "user_customer_user_id_idx" ON "user_customer" ("user_id");
-- Create index "user_document_document_partial_idx" to table: "user_document"
CREATE INDEX "user_document_document_partial_idx" ON "user_document" ("document_partial");
-- Create index "user_document_user_document_type_id_idx" to table: "user_document"
CREATE INDEX "user_document_user_document_type_id_idx" ON "user_document" ("user_document_type_id");
-- Create index "user_document_user_id_idx" to table: "user_document"
CREATE INDEX "user_document_user_id_idx" ON "user_document" ("user_id");
-- Create index "user_document_type_name_idx" to table: "user_document_type"
CREATE INDEX "user_document_type_name_idx" ON "user_document_type" ("name");
-- Create index "user_info_deleted_at_idx" to table: "user_info"
CREATE INDEX "user_info_deleted_at_idx" ON "user_info" ("deleted_at");
-- Create index "user_info_phone_partial_idx" to table: "user_info"
CREATE INDEX "user_info_phone_partial_idx" ON "user_info" ("phone_partial");
-- Create index "user_info_user_id_idx" to table: "user_info"
CREATE INDEX "user_info_user_id_idx" ON "user_info" ("user_id");
-- Create index "user_status_name_idx" to table: "user_status"
CREATE INDEX "user_status_name_idx" ON "user_status" ("name");
-- Create index "worker_account_id_idx" to table: "worker"
CREATE INDEX "worker_account_id_idx" ON "worker" ("account_id");
-- Create index "worker_deleted_at_idx" to table: "worker"
CREATE INDEX "worker_deleted_at_idx" ON "worker" ("deleted_at");
-- Create index "worker_server_id_idx" to table: "worker"
CREATE INDEX "worker_server_id_idx" ON "worker" ("server_id");
-- Create index "worker_worker_status_id_idx" to table: "worker"
CREATE INDEX "worker_worker_status_id_idx" ON "worker" ("worker_status_id");
-- Create index "worker_worker_type_id_idx" to table: "worker"
CREATE INDEX "worker_worker_type_id_idx" ON "worker" ("worker_type_id");
-- Create index "worker_config_chatbot_id_idx" to table: "worker_config"
CREATE INDEX "worker_config_chatbot_id_idx" ON "worker_config" ("chatbot_id");
-- Create index "worker_config_worker_config_status_id_idx" to table: "worker_config"
CREATE INDEX "worker_config_worker_config_status_id_idx" ON "worker_config" ("worker_config_status_id");
-- Create index "worker_config_worker_config_type_id_idx" to table: "worker_config"
CREATE INDEX "worker_config_worker_config_type_id_idx" ON "worker_config" ("worker_config_type_id");
-- Create index "worker_config_worker_id_idx" to table: "worker_config"
CREATE INDEX "worker_config_worker_id_idx" ON "worker_config" ("worker_id");
-- Create index "worker_config_status_status_idx" to table: "worker_config_status"
CREATE INDEX "worker_config_status_status_idx" ON "worker_config_status" ("status");
-- Create index "worker_config_type_type_idx" to table: "worker_config_type"
CREATE INDEX "worker_config_type_type_idx" ON "worker_config_type" ("type");
-- Create index "worker_phone_connection_number_idx" to table: "worker_phone_connection"
CREATE INDEX "worker_phone_connection_number_idx" ON "worker_phone_connection" ("number");
-- Create index "worker_phone_connection_worker_id_idx" to table: "worker_phone_connection"
CREATE INDEX "worker_phone_connection_worker_id_idx" ON "worker_phone_connection" ("worker_id");
-- Create index "worker_profile_info_worker_id_idx" to table: "worker_profile_info"
CREATE INDEX "worker_profile_info_worker_id_idx" ON "worker_profile_info" ("worker_id");
-- Create index "worker_profile_status_worker_id_idx" to table: "worker_profile_status"
CREATE INDEX "worker_profile_status_worker_id_idx" ON "worker_profile_status" ("worker_id");
-- Create index "worker_profile_status_worker_profile_status_type_id_idx" to table: "worker_profile_status"
CREATE INDEX "worker_profile_status_worker_profile_status_type_id_idx" ON "worker_profile_status" ("worker_profile_status_type_id");
-- Create index "worker_profile_status_contact_contact_id_idx" to table: "worker_profile_status_contact"
CREATE INDEX "worker_profile_status_contact_contact_id_idx" ON "worker_profile_status_contact" ("contact_id");
-- Create index "worker_profile_status_contact_worker_profile_status_id_idx" to table: "worker_profile_status_contact"
CREATE INDEX "worker_profile_status_contact_worker_profile_status_id_idx" ON "worker_profile_status_contact" ("worker_profile_status_id");
-- Create index "worker_profile_status_type_type_idx" to table: "worker_profile_status_type"
CREATE INDEX "worker_profile_status_type_type_idx" ON "worker_profile_status_type" ("type");
-- Create index "worker_status_status_idx" to table: "worker_status"
CREATE INDEX "worker_status_status_idx" ON "worker_status" ("status");
-- Create index "worker_type_type_idx" to table: "worker_type"
CREATE INDEX "worker_type_type_idx" ON "worker_type" ("type");
-- Create index "zipcode_fiscal_code_idx" to table: "zipcode"
CREATE INDEX "zipcode_fiscal_code_idx" ON "zipcode" ("fiscal_code");
-- Create index "zipcode_id_country_idx" to table: "zipcode"
CREATE INDEX "zipcode_id_country_idx" ON "zipcode" ("id_country");
-- Create index "zipcode_id_zipcode_city_idx" to table: "zipcode"
CREATE INDEX "zipcode_id_zipcode_city_idx" ON "zipcode" ("id_zipcode_city");
-- Create index "zipcode_id_zipcode_district_idx" to table: "zipcode"
CREATE INDEX "zipcode_id_zipcode_district_idx" ON "zipcode" ("id_zipcode_district");
-- Create index "zipcode_id_zipcode_state_idx" to table: "zipcode"
CREATE INDEX "zipcode_id_zipcode_state_idx" ON "zipcode" ("id_zipcode_state");
-- Create index "zipcode_zipcode_idx" to table: "zipcode"
CREATE INDEX "zipcode_zipcode_idx" ON "zipcode" ("zipcode");
-- Create index "zipcode_city_fiscal_code_idx" to table: "zipcode_city"
CREATE INDEX "zipcode_city_fiscal_code_idx" ON "zipcode_city" ("fiscal_code");
-- Create index "zipcode_city_id_country_idx" to table: "zipcode_city"
CREATE INDEX "zipcode_city_id_country_idx" ON "zipcode_city" ("id_country");
-- Create index "zipcode_city_id_zipcode_state_idx" to table: "zipcode_city"
CREATE INDEX "zipcode_city_id_zipcode_state_idx" ON "zipcode_city" ("id_zipcode_state");
-- Create index "zipcode_district_id_country_idx" to table: "zipcode_district"
CREATE INDEX "zipcode_district_id_country_idx" ON "zipcode_district" ("id_country");
-- Create index "zipcode_district_id_zipcode_city_idx" to table: "zipcode_district"
CREATE INDEX "zipcode_district_id_zipcode_city_idx" ON "zipcode_district" ("id_zipcode_city");
-- Create index "zipcode_district_id_zipcode_state_idx" to table: "zipcode_district"
CREATE INDEX "zipcode_district_id_zipcode_state_idx" ON "zipcode_district" ("id_zipcode_state");
-- Create index "zipcode_state_abbreviation_idx" to table: "zipcode_state"
CREATE INDEX "zipcode_state_abbreviation_idx" ON "zipcode_state" ("abbreviation");
-- Create index "zipcode_state_fiscal_code_idx" to table: "zipcode_state"
CREATE INDEX "zipcode_state_fiscal_code_idx" ON "zipcode_state" ("fiscal_code");
-- Create index "zipcode_state_id_country_idx" to table: "zipcode_state"
CREATE INDEX "zipcode_state_id_country_idx" ON "zipcode_state" ("id_country");
