CREATE TABLE "user" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"user_status_id" uuid NOT NULL,
	"email" varchar(500) NOT NULL,
	"email_partial" varchar(50) NOT NULL,
	"email_c" varchar(500) NOT NULL,
	"password" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_status" (
	"user_status_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_address" (
	"user_address_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"country_id" smallint NOT NULL,
	"zip_code" varchar(10),
	"address1" varchar(1000),
	"address1_partial" varchar(200),
	"address1_c" varchar(500),
	"address2" varchar(1000),
	"address2_partial" varchar(200),
	"address2_c" varchar(500),
	"city_fiscal_code" varchar(10),
	"state_fiscal_code" varchar(10),
	"district" varchar(100),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_document" (
	"user_document_id" uuid PRIMARY KEY NOT NULL,
	"user_document_type_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"document" varchar(500),
	"document_partial" varchar(50),
	"document_c" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_document_type" (
	"user_document_type_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_info" (
	"user_info_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_ddi" varchar(5),
	"phone" varchar(500),
	"phone_partial" varchar(15),
	"phone_c" varchar(500),
	"phone_jid" varchar(500),
	"photo" varchar(255),
	"name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"birth_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_card" (
	"user_card_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(500) NOT NULL,
	"holder_name" varchar(500) NOT NULL,
	"last_number" varchar(10) NOT NULL,
	"brand" varchar(50) NOT NULL,
	"default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_customer" (
	"user_customer_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"user_customer" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_channel" (
	"user_channel_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "server" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"server_status_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"quantity_workers" integer NOT NULL,
	"last_sync" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "server_ssh" (
	"server_ssh_id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"ssh_ip" varchar(200) NOT NULL,
	"ssh_port" integer NOT NULL,
	"ssh_username" varchar(1000) NOT NULL,
	"ssh_password" varchar(1000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "server_status" (
	"server_status_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "server_web" (
	"server_web_id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"web_domain" varchar(200) NOT NULL,
	"web_port" integer NOT NULL,
	"web_protocol" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "permission_action" (
	"permission_action_id" uuid PRIMARY KEY NOT NULL,
	"permission_module_id" uuid NOT NULL,
	"permission_action_group_id" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "permission_action_groups" (
	"permission_action_group_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" varchar(500),
	"action" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "permission_role" (
	"permission_role_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "permission_module" (
	"module_id" uuid PRIMARY KEY NOT NULL,
	"module" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "permission_assignment" (
	"permission_assignment_id" uuid PRIMARY KEY NOT NULL,
	"permission_role_id" uuid NOT NULL,
	"user_id" uuid,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "permission_role_action" (
	"permission_role_action_id" uuid PRIMARY KEY NOT NULL,
	"permission_action_id" uuid,
	"permission_action_group_id" uuid,
	"permission_role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "country" (
	"country_id" smallint PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "country_country_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"iso_code" varchar(3) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "zipcode_state" (
	"id_zipcode_state" uuid PRIMARY KEY NOT NULL,
	"id_country" smallint NOT NULL,
	"abbreviation" varchar(3),
	"capital" varchar(100),
	"fiscal_code" varchar(10),
	"latitude" numeric(10, 6),
	"longitude" numeric(10, 6),
	"region" varchar(100),
	"state" varchar(100) NOT NULL,
	"zipcode_end" varchar(15),
	"zipcode_start" varchar(15),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "zipcode_city" (
	"id_zipcode_city" uuid PRIMARY KEY NOT NULL,
	"id_country" smallint NOT NULL,
	"id_zipcode_state" uuid NOT NULL,
	"city" varchar(100) NOT NULL,
	"city_area" varchar(100),
	"fiscal_code" varchar(10),
	"latitude" numeric(10, 6),
	"longitude" numeric(10, 6),
	"phone_code" varchar(5),
	"zipcode_end" varchar(15),
	"zipcode_start" varchar(15),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "zipcode_district" (
	"id_zipcode_district" uuid PRIMARY KEY NOT NULL,
	"id_country" smallint NOT NULL,
	"id_zipcode_city" uuid NOT NULL,
	"id_zipcode_state" uuid NOT NULL,
	"district" varchar(100) NOT NULL,
	"latitude" numeric(10, 6),
	"longitude" numeric(10, 6),
	"zipcode_end" varchar(15),
	"zipcode_start" varchar(15),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "zipcode" (
	"id_zipcode" uuid PRIMARY KEY NOT NULL,
	"id_country" smallint NOT NULL,
	"id_zipcode_city" uuid,
	"id_zipcode_district" uuid,
	"id_zipcode_state" uuid,
	"address_1" varchar(200) NOT NULL,
	"address_2" varchar(200),
	"enable" boolean NOT NULL,
	"fiscal_code" varchar(50),
	"latitude" numeric(10, 6),
	"longitude" numeric(10, 6),
	"type" varchar(50),
	"zipcode" varchar(15),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"api_key_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"worker_id" uuid,
	"key" varchar(32) NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"account_status_id" uuid NOT NULL,
	"name" varchar(10) NOT NULL,
	"generate_invoice" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account_status" (
	"account_status_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account_info" (
	"account_info_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"logo" varchar(500),
	"content_width" varchar(10) DEFAULT 'fluid',
	"content_layout_nav" varchar(15) DEFAULT 'vertical',
	"default_locale" varchar(5) DEFAULT 'pt',
	"skin" varchar(20) DEFAULT 'default',
	"navbar" varchar(20) DEFAULT 'sticky',
	"footer" varchar(20) DEFAULT 'sticky',
	"is_vertical_nav_collapsed" boolean DEFAULT false,
	"is_vertical_nav_semi_dark" boolean DEFAULT true,
	"light_primary_color" varchar(20) DEFAULT '#2865B7',
	"light_secondary_color" varchar(20) DEFAULT '#5098E5',
	"dark_primary_color" varchar(20) DEFAULT '#152642',
	"dark_secondary_color" varchar(20) DEFAULT '#2865B7',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account_payment" (
	"account_payment_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"user_customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing" varchar(500) NOT NULL,
	"payment_billing_type_id" uuid NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"net_value" numeric(10, 2) NOT NULL,
	"user_card_id" uuid,
	"installment" numeric(10, 2),
	"boleto" varchar(500),
	"boleto_number" varchar(100),
	"boleto_pdf" varchar(500),
	"pix_transaction" varchar(500),
	"payment_status_id" uuid NOT NULL,
	"payment_date" timestamp with time zone,
	"billing_period_id" uuid,
	"invoice_url" varchar(1000),
	"recurring_payment" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account_payment_cross_sell" (
	"account_payment_cross_sell_id" uuid PRIMARY KEY NOT NULL,
	"plan_cross_sell_id" uuid NOT NULL,
	"account_payment_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account_payment_nfse" (
	"account_payment_nfse_id" uuid PRIMARY KEY NOT NULL,
	"account_payment_id" uuid NOT NULL,
	"reference" varchar(100) NOT NULL,
	"account_payment_nfse_status_id" uuid NOT NULL,
	"nfse_id" uuid NOT NULL,
	"type" varchar(50),
	"status_description" varchar(500),
	"pdf_url" varchar(1000),
	"xml_url" varchar(1000),
	"rps_serie" varchar(50),
	"number" varchar(100),
	"validation_code" varchar(200),
	"value" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account_payment_nfse_status" (
	"account_payment_nfse_status_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_period" (
	"billing_period_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_billing_type" (
	"payment_billing_type_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_status" (
	"payment_status_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "account_test" (
	"account_test_id" uuid PRIMARY KEY NOT NULL,
	"document" varchar(500) NOT NULL,
	"document_c" varchar(500) NOT NULL,
	"phone" varchar(500) NOT NULL,
	"phone_c" varchar(500) NOT NULL,
	"email" varchar(500) NOT NULL,
	"email_c" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker" (
	"worker_id" uuid PRIMARY KEY NOT NULL,
	"worker_status_id" uuid NOT NULL,
	"worker_type_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"number" varchar(20),
	"container_id" varchar(100),
	"connection_date" timestamp with time zone,
	"last_connection_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worker_status" (
	"worker_status_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_type" (
	"worker_type_id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_phone_connection" (
	"worker_phone_connection_id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"number" varchar(20),
	"attempt" integer DEFAULT 0 NOT NULL,
	"date_attempt" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_config_status" (
	"worker_config_status_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_config_type" (
	"worker_config_type_id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_config" (
	"worker_config_id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"worker_config_status_id" uuid NOT NULL,
	"worker_config_type_id" uuid NOT NULL,
	"chatbot_id" uuid,
	"value" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_profile_status" (
	"worker_profile_status_id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"worker_profile_status_type_id" uuid NOT NULL,
	"value" varchar(500) NOT NULL,
	"is_permanent" boolean DEFAULT false,
	"external_id" varchar(500),
	"mimetype" varchar(100),
	"duration" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_profile_status_type" (
	"worker_profile_status_type_id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_profile_info" (
	"worker_profile_info_id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"name" varchar(100),
	"message" varchar(500),
	"photo" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_profile_status_contact" (
	"worker_profile_status_contact_id" uuid PRIMARY KEY NOT NULL,
	"worker_profile_status_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"price_old" numeric(10, 2) NOT NULL,
	"description" varchar(500),
	"annual_discount" numeric(5, 2),
	"icon" varchar(100),
	"is_test" boolean DEFAULT false NOT NULL,
	"days_trial" integer,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"is_exclusive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_product" (
	"plan_product_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "plan_product_description" (
	"plan_product_description_id" uuid PRIMARY KEY NOT NULL,
	"plan_product_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "plan_product_description_plan_product_id_unique" UNIQUE("plan_product_id")
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"plan_item_id" uuid PRIMARY KEY NOT NULL,
	"plan_product_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_cross_sell" (
	"plan_cross_sell_id" uuid PRIMARY KEY NOT NULL,
	"plan_product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_cross_sell_account" (
	"plan_cross_sell_account_id" uuid PRIMARY KEY NOT NULL,
	"plan_cross_sell_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_account" (
	"plan_account_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"account_payment_id" uuid,
	"billing_period_id" uuid,
	"recurring_payment" boolean DEFAULT false NOT NULL,
	"last_payment_date" timestamp with time zone,
	"next_payment_date" timestamp with time zone,
	"cancellation_date" timestamp with time zone,
	"value" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "plan_account_exclusive" (
	"plan_account_exclusive_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sector" (
	"sector_id" uuid PRIMARY KEY NOT NULL,
	"sector_status_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sector_status" (
	"sector_status_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sector_user" (
	"sector_user_id" uuid PRIMARY KEY NOT NULL,
	"sector_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_user" (
	"chat_user_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"about" varchar(200),
	"notifications" boolean DEFAULT true,
	"sort_by_chat_order" varchar(50),
	"sort_in_chat_order" varchar(10),
	"sort_by_my_chats_order" varchar(50),
	"sort_my_chats_order" varchar(10),
	"sort_by_queue_order" varchar(50),
	"sort_queue_order" varchar(10),
	"sort_by_chatbot_order" varchar(50),
	"sort_chatbot_order" varchar(10),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chatbot" (
	"chatbot_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(20) DEFAULT 'input',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "message_template" (
	"message_template_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"message_status_id" uuid NOT NULL,
	"command" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"attachment_url" varchar(500),
	"type" varchar(50) DEFAULT 'text' NOT NULL,
	"mimetype" varchar(100),
	"duration" integer,
	"width" integer,
	"height" integer,
	"auto_send" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_status" (
	"message_status_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_template" (
	"label_template_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"label_status_id" uuid NOT NULL,
	"label" text NOT NULL,
	"color" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "label_status" (
	"label_status_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"contact_document_type_id" uuid,
	"is_valided" boolean DEFAULT false,
	"name" varchar(100) NOT NULL,
	"last_name" varchar(100),
	"email" varchar(500),
	"email_partial" varchar(50),
	"email_c" varchar(500),
	"phone_ddi" varchar(5),
	"phone" varchar(500),
	"phone_partial" varchar(15),
	"phone_c" varchar(500),
	"nickname" varchar(100),
	"photo" varchar(500),
	"birthday" timestamp with time zone,
	"notes" text,
	"document" varchar(500),
	"document_partial" varchar(20),
	"document_c" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"user_id" uuid,
	"ignore" varchar(20) DEFAULT 'not_ignore',
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_group" (
	"contact_group_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_group_assignment" (
	"contact_group_assignment_id" uuid PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"contact_group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_document_type" (
	"contact_document_type_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_label_template" (
	"contact_label_template_id" uuid PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"label_template_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expenditure" (
	"expenditure_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"notification_id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid,
	"notification_type_id" uuid NOT NULL,
	"message_whatsapp" text,
	"email_subject" text,
	"message_email" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_type" (
	"notification_type_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nfse" (
	"nfse_id" uuid PRIMARY KEY NOT NULL,
	"external_id" integer,
	"name" varchar(500) NOT NULL,
	"municipal_service_description_field" varchar(500),
	"municipal_service_code" varchar(50),
	"retain_iss" boolean DEFAULT false NOT NULL,
	"iss_value" numeric(10, 5),
	"cofins_value" numeric(10, 5),
	"csll_value" numeric(10, 5),
	"inss_value" numeric(10, 5),
	"ir_value" numeric(10, 5),
	"pis_value" numeric(10, 5),
	"deductions" numeric(10, 5),
	"default_product" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "report_conversation_history_pdf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"url_pdf" text,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now(),
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scheduled_contact" (
	"scheduled_contact_id" uuid PRIMARY KEY NOT NULL,
	"schedule_id" uuid NOT NULL,
	"contact_group_id" uuid,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schedule" (
	"schedule_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"send_to" varchar(30) NOT NULL,
	"send_speed" varchar(20) DEFAULT 'low' NOT NULL,
	"chatbot_id" uuid,
	"message" text,
	"url" varchar(500),
	"mimetype" varchar(100),
	"duration" integer,
	"width" integer,
	"height" integer,
	"send_date" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"two_factor_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"phone_ddi" varchar(5),
	"phone" varchar(500),
	"phone_partial" varchar(15),
	"phone_c" varchar(500),
	"email" varchar(500),
	"email_partial" varchar(50),
	"email_c" varchar(500),
	"code" varchar(8) NOT NULL,
	"token" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credit_card_fee" (
	"credit_card_fee_id" uuid PRIMARY KEY NOT NULL,
	"installment_1_rate" numeric(5, 2) NOT NULL,
	"installment_2_rate" numeric(5, 2) NOT NULL,
	"installment_3_rate" numeric(5, 2) NOT NULL,
	"installment_4_rate" numeric(5, 2) NOT NULL,
	"installment_5_rate" numeric(5, 2) NOT NULL,
	"installment_6_rate" numeric(5, 2) NOT NULL,
	"installment_7_rate" numeric(5, 2) NOT NULL,
	"installment_8_rate" numeric(5, 2) NOT NULL,
	"installment_9_rate" numeric(5, 2) NOT NULL,
	"installment_10_rate" numeric(5, 2) NOT NULL,
	"installment_11_rate" numeric(5, 2) NOT NULL,
	"installment_12_rate" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "method_payment" (
	"method_payment_id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(20) DEFAULT 'boleto' NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_agent_type" (
	"ai_agent_type_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_agent" (
	"ai_agent_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"ai_agent_type_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"base_url" varchar(500),
	"api_key" varchar(2000),
	"model" varchar(100),
	"embedding_model" varchar(100),
	"chunk_size" varchar(10) DEFAULT '600' NOT NULL,
	"chunk_overlap" varchar(10) DEFAULT '100' NOT NULL,
	"openai_assistant_id" varchar(200),
	"openai_vector_store_id" varchar(200),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"system_prompt" text,
	"enable_human_transfer" boolean DEFAULT false,
	"enable_human_transfer_by_prompt" boolean DEFAULT false,
	"voice_ia_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_agent_prompt" (
	"ai_agent_prompt_id" uuid PRIMARY KEY NOT NULL,
	"ai_agent_id" uuid NOT NULL,
	"value" text NOT NULL,
	"openai_file_id" varchar(200),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_agent_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_agent_id" uuid NOT NULL,
	"account_id" uuid,
	"chat_id" varchar(500),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"model" varchar(100),
	"latency_ms" integer,
	"success" boolean,
	"request_type" varchar(50),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_agent_human_transfer_target" (
	"ai_agent_human_transfer_target_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_agent_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"sector_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "voice_ia" (
	"voice_ia_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"voice_ia_type" varchar(50) DEFAULT 'eleven_labs' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"api_key" varchar(2000),
	"language_code" varchar(10) DEFAULT 'pt' NOT NULL,
	"voice_id" varchar(100) NOT NULL,
	"model_id" varchar(100) DEFAULT 'eleven_multilingual_v2' NOT NULL,
	"speed" varchar(10) DEFAULT '1' NOT NULL,
	"stability" varchar(10) DEFAULT '0.5' NOT NULL,
	"similarity_boost" varchar(10) DEFAULT '0.75' NOT NULL,
	"style_exaggeration" varchar(10) DEFAULT '0' NOT NULL,
	"enable_transcription" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"push_subscription_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" varchar(500),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "release" (
	"release_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"created_by_user_id" uuid,
	"type" varchar(20) DEFAULT 'informative' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "release_access" (
	"release_access_id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"account_id" uuid,
	"user_id" uuid,
	"permission_role_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "release_view" (
	"release_view_id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_user_status_id_user_status_user_status_id_fk" FOREIGN KEY ("user_status_id") REFERENCES "public"."user_status"("user_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_address" ADD CONSTRAINT "user_address_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_address" ADD CONSTRAINT "user_address_country_id_country_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."country"("country_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_document" ADD CONSTRAINT "user_document_user_document_type_id_user_document_type_user_document_type_id_fk" FOREIGN KEY ("user_document_type_id") REFERENCES "public"."user_document_type"("user_document_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_document" ADD CONSTRAINT "user_document_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_info" ADD CONSTRAINT "user_info_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_card" ADD CONSTRAINT "user_card_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_customer" ADD CONSTRAINT "user_customer_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_channel" ADD CONSTRAINT "user_channel_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_channel" ADD CONSTRAINT "user_channel_channel_id_worker_worker_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_channel" ADD CONSTRAINT "user_channel_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_server_status_id_server_status_server_status_id_fk" FOREIGN KEY ("server_status_id") REFERENCES "public"."server_status"("server_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_ssh" ADD CONSTRAINT "server_ssh_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_web" ADD CONSTRAINT "server_web_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_action" ADD CONSTRAINT "permission_action_permission_module_id_permission_module_module_id_fk" FOREIGN KEY ("permission_module_id") REFERENCES "public"."permission_module"("module_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_action" ADD CONSTRAINT "permission_action_permission_action_group_id_permission_action_groups_permission_action_group_id_fk" FOREIGN KEY ("permission_action_group_id") REFERENCES "public"."permission_action_groups"("permission_action_group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_role" ADD CONSTRAINT "permission_role_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_assignment" ADD CONSTRAINT "permission_assignment_permission_role_id_permission_role_permission_role_id_fk" FOREIGN KEY ("permission_role_id") REFERENCES "public"."permission_role"("permission_role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_assignment" ADD CONSTRAINT "permission_assignment_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_assignment" ADD CONSTRAINT "permission_assignment_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_role_action" ADD CONSTRAINT "permission_role_action_permission_action_id_permission_action_permission_action_id_fk" FOREIGN KEY ("permission_action_id") REFERENCES "public"."permission_action"("permission_action_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_role_action" ADD CONSTRAINT "permission_role_action_permission_action_group_id_permission_action_groups_permission_action_group_id_fk" FOREIGN KEY ("permission_action_group_id") REFERENCES "public"."permission_action_groups"("permission_action_group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_role_action" ADD CONSTRAINT "permission_role_action_permission_role_id_permission_role_permission_role_id_fk" FOREIGN KEY ("permission_role_id") REFERENCES "public"."permission_role"("permission_role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode_state" ADD CONSTRAINT "zipcode_state_id_country_country_country_id_fk" FOREIGN KEY ("id_country") REFERENCES "public"."country"("country_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode_city" ADD CONSTRAINT "zipcode_city_id_country_country_country_id_fk" FOREIGN KEY ("id_country") REFERENCES "public"."country"("country_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode_city" ADD CONSTRAINT "zipcode_city_id_zipcode_state_zipcode_state_id_zipcode_state_fk" FOREIGN KEY ("id_zipcode_state") REFERENCES "public"."zipcode_state"("id_zipcode_state") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode_district" ADD CONSTRAINT "zipcode_district_id_country_country_country_id_fk" FOREIGN KEY ("id_country") REFERENCES "public"."country"("country_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode_district" ADD CONSTRAINT "zipcode_district_id_zipcode_city_zipcode_city_id_zipcode_city_fk" FOREIGN KEY ("id_zipcode_city") REFERENCES "public"."zipcode_city"("id_zipcode_city") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode_district" ADD CONSTRAINT "zipcode_district_id_zipcode_state_zipcode_state_id_zipcode_state_fk" FOREIGN KEY ("id_zipcode_state") REFERENCES "public"."zipcode_state"("id_zipcode_state") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode" ADD CONSTRAINT "zipcode_id_country_country_country_id_fk" FOREIGN KEY ("id_country") REFERENCES "public"."country"("country_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode" ADD CONSTRAINT "zipcode_id_zipcode_city_zipcode_city_id_zipcode_city_fk" FOREIGN KEY ("id_zipcode_city") REFERENCES "public"."zipcode_city"("id_zipcode_city") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode" ADD CONSTRAINT "zipcode_id_zipcode_district_zipcode_district_id_zipcode_district_fk" FOREIGN KEY ("id_zipcode_district") REFERENCES "public"."zipcode_district"("id_zipcode_district") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zipcode" ADD CONSTRAINT "zipcode_id_zipcode_state_zipcode_state_id_zipcode_state_fk" FOREIGN KEY ("id_zipcode_state") REFERENCES "public"."zipcode_state"("id_zipcode_state") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_account_status_id_account_status_account_status_id_fk" FOREIGN KEY ("account_status_id") REFERENCES "public"."account_status"("account_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_info" ADD CONSTRAINT "account_info_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_user_customer_id_user_customer_user_customer_id_fk" FOREIGN KEY ("user_customer_id") REFERENCES "public"."user_customer"("user_customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_plan_id_plan_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_payment_billing_type_id_payment_billing_type_payment_billing_type_id_fk" FOREIGN KEY ("payment_billing_type_id") REFERENCES "public"."payment_billing_type"("payment_billing_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_user_card_id_user_card_user_card_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_card"("user_card_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_payment_status_id_payment_status_payment_status_id_fk" FOREIGN KEY ("payment_status_id") REFERENCES "public"."payment_status"("payment_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment" ADD CONSTRAINT "account_payment_billing_period_id_billing_period_billing_period_id_fk" FOREIGN KEY ("billing_period_id") REFERENCES "public"."billing_period"("billing_period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_cross_sell" ADD CONSTRAINT "account_payment_cross_sell_plan_cross_sell_id_plan_cross_sell_plan_cross_sell_id_fk" FOREIGN KEY ("plan_cross_sell_id") REFERENCES "public"."plan_cross_sell"("plan_cross_sell_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_cross_sell" ADD CONSTRAINT "account_payment_cross_sell_account_payment_id_account_payment_account_payment_id_fk" FOREIGN KEY ("account_payment_id") REFERENCES "public"."account_payment"("account_payment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_nfse" ADD CONSTRAINT "account_payment_nfse_account_payment_id_account_payment_account_payment_id_fk" FOREIGN KEY ("account_payment_id") REFERENCES "public"."account_payment"("account_payment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_nfse" ADD CONSTRAINT "account_payment_nfse_account_payment_nfse_status_id_account_payment_nfse_status_account_payment_nfse_status_id_fk" FOREIGN KEY ("account_payment_nfse_status_id") REFERENCES "public"."account_payment_nfse_status"("account_payment_nfse_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_payment_nfse" ADD CONSTRAINT "account_payment_nfse_nfse_id_nfse_nfse_id_fk" FOREIGN KEY ("nfse_id") REFERENCES "public"."nfse"("nfse_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_worker_status_id_worker_status_worker_status_id_fk" FOREIGN KEY ("worker_status_id") REFERENCES "public"."worker_status"("worker_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_worker_type_id_worker_type_worker_type_id_fk" FOREIGN KEY ("worker_type_id") REFERENCES "public"."worker_type"("worker_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_phone_connection" ADD CONSTRAINT "worker_phone_connection_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_config" ADD CONSTRAINT "worker_config_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_config" ADD CONSTRAINT "worker_config_worker_config_status_id_worker_config_status_worker_config_status_id_fk" FOREIGN KEY ("worker_config_status_id") REFERENCES "public"."worker_config_status"("worker_config_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_config" ADD CONSTRAINT "worker_config_worker_config_type_id_worker_config_type_worker_config_type_id_fk" FOREIGN KEY ("worker_config_type_id") REFERENCES "public"."worker_config_type"("worker_config_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_config" ADD CONSTRAINT "worker_config_chatbot_id_chatbot_chatbot_id_fk" FOREIGN KEY ("chatbot_id") REFERENCES "public"."chatbot"("chatbot_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profile_status" ADD CONSTRAINT "worker_profile_status_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profile_status" ADD CONSTRAINT "worker_profile_status_worker_profile_status_type_id_worker_profile_status_type_worker_profile_status_type_id_fk" FOREIGN KEY ("worker_profile_status_type_id") REFERENCES "public"."worker_profile_status_type"("worker_profile_status_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profile_info" ADD CONSTRAINT "worker_profile_info_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profile_status_contact" ADD CONSTRAINT "worker_profile_status_contact_worker_profile_status_id_worker_profile_status_worker_profile_status_id_fk" FOREIGN KEY ("worker_profile_status_id") REFERENCES "public"."worker_profile_status"("worker_profile_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profile_status_contact" ADD CONSTRAINT "worker_profile_status_contact_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("contact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_product_description" ADD CONSTRAINT "plan_product_description_plan_product_id_plan_product_plan_product_id_fk" FOREIGN KEY ("plan_product_id") REFERENCES "public"."plan_product"("plan_product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_product_id_plan_product_plan_product_id_fk" FOREIGN KEY ("plan_product_id") REFERENCES "public"."plan_product"("plan_product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_plan_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_cross_sell" ADD CONSTRAINT "plan_cross_sell_plan_product_id_plan_product_plan_product_id_fk" FOREIGN KEY ("plan_product_id") REFERENCES "public"."plan_product"("plan_product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_cross_sell_account" ADD CONSTRAINT "plan_cross_sell_account_plan_cross_sell_id_plan_cross_sell_plan_cross_sell_id_fk" FOREIGN KEY ("plan_cross_sell_id") REFERENCES "public"."plan_cross_sell"("plan_cross_sell_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_cross_sell_account" ADD CONSTRAINT "plan_cross_sell_account_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_account" ADD CONSTRAINT "plan_account_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_account" ADD CONSTRAINT "plan_account_plan_id_plan_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_account" ADD CONSTRAINT "plan_account_account_payment_id_account_payment_account_payment_id_fk" FOREIGN KEY ("account_payment_id") REFERENCES "public"."account_payment"("account_payment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_account" ADD CONSTRAINT "plan_account_billing_period_id_billing_period_billing_period_id_fk" FOREIGN KEY ("billing_period_id") REFERENCES "public"."billing_period"("billing_period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_account_exclusive" ADD CONSTRAINT "plan_account_exclusive_plan_id_plan_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_account_exclusive" ADD CONSTRAINT "plan_account_exclusive_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector" ADD CONSTRAINT "sector_sector_status_id_sector_status_sector_status_id_fk" FOREIGN KEY ("sector_status_id") REFERENCES "public"."sector_status"("sector_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector" ADD CONSTRAINT "sector_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_user" ADD CONSTRAINT "sector_user_sector_id_sector_sector_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sector"("sector_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_user" ADD CONSTRAINT "sector_user_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_user" ADD CONSTRAINT "chat_user_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatbot" ADD CONSTRAINT "chatbot_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_message_status_id_message_status_message_status_id_fk" FOREIGN KEY ("message_status_id") REFERENCES "public"."message_status"("message_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_template" ADD CONSTRAINT "label_template_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_template" ADD CONSTRAINT "label_template_label_status_id_label_status_label_status_id_fk" FOREIGN KEY ("label_status_id") REFERENCES "public"."label_status"("label_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_contact_document_type_id_contact_document_type_contact_document_type_id_fk" FOREIGN KEY ("contact_document_type_id") REFERENCES "public"."contact_document_type"("contact_document_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group" ADD CONSTRAINT "contact_group_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_assignment" ADD CONSTRAINT "contact_group_assignment_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("contact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_assignment" ADD CONSTRAINT "contact_group_assignment_contact_group_id_contact_group_contact_group_id_fk" FOREIGN KEY ("contact_group_id") REFERENCES "public"."contact_group"("contact_group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_label_template" ADD CONSTRAINT "contact_label_template_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("contact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_label_template" ADD CONSTRAINT "contact_label_template_label_template_id_label_template_label_template_id_fk" FOREIGN KEY ("label_template_id") REFERENCES "public"."label_template"("label_template_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_notification_type_id_notification_type_notification_type_id_fk" FOREIGN KEY ("notification_type_id") REFERENCES "public"."notification_type"("notification_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_conversation_history_pdf" ADD CONSTRAINT "report_conversation_history_pdf_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_contact" ADD CONSTRAINT "scheduled_contact_schedule_id_schedule_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("schedule_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_contact" ADD CONSTRAINT "scheduled_contact_contact_group_id_contact_group_contact_group_id_fk" FOREIGN KEY ("contact_group_id") REFERENCES "public"."contact_group"("contact_group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_contact" ADD CONSTRAINT "scheduled_contact_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("contact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_chatbot_id_chatbot_chatbot_id_fk" FOREIGN KEY ("chatbot_id") REFERENCES "public"."chatbot"("chatbot_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_ai_agent_type_id_ai_agent_type_ai_agent_type_id_fk" FOREIGN KEY ("ai_agent_type_id") REFERENCES "public"."ai_agent_type"("ai_agent_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_voice_ia_id_voice_ia_voice_ia_id_fk" FOREIGN KEY ("voice_ia_id") REFERENCES "public"."voice_ia"("voice_ia_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_prompt" ADD CONSTRAINT "ai_agent_prompt_ai_agent_id_ai_agent_ai_agent_id_fk" FOREIGN KEY ("ai_agent_id") REFERENCES "public"."ai_agent"("ai_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_usage" ADD CONSTRAINT "ai_agent_usage_ai_agent_id_ai_agent_ai_agent_id_fk" FOREIGN KEY ("ai_agent_id") REFERENCES "public"."ai_agent"("ai_agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_human_transfer_target" ADD CONSTRAINT "ai_agent_human_transfer_target_ai_agent_id_ai_agent_ai_agent_id_fk" FOREIGN KEY ("ai_agent_id") REFERENCES "public"."ai_agent"("ai_agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_human_transfer_target" ADD CONSTRAINT "ai_agent_human_transfer_target_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_human_transfer_target" ADD CONSTRAINT "ai_agent_human_transfer_target_sector_id_sector_sector_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sector"("sector_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_human_transfer_target" ADD CONSTRAINT "ai_agent_human_transfer_target_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_ia" ADD CONSTRAINT "voice_ia_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_created_by_user_id_user_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_access" ADD CONSTRAINT "release_access_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_access" ADD CONSTRAINT "release_access_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_access" ADD CONSTRAINT "release_access_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_access" ADD CONSTRAINT "release_access_permission_role_id_permission_role_permission_role_id_fk" FOREIGN KEY ("permission_role_id") REFERENCES "public"."permission_role"("permission_role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_view" ADD CONSTRAINT "release_view_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_view" ADD CONSTRAINT "release_view_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_account_id_idx" ON "user" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "user_user_status_id_idx" ON "user" USING btree ("user_status_id");--> statement-breakpoint
CREATE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_email_partial_idx" ON "user" USING btree ("email_partial");--> statement-breakpoint
CREATE INDEX "user_deleted_at_idx" ON "user" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "user_account_id_deleted_at_idx" ON "user" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "user_account_id_user_status_id_deleted_at_idx" ON "user" USING btree ("account_id","user_status_id","deleted_at");--> statement-breakpoint
CREATE INDEX "user_email_c_deleted_at_idx" ON "user" USING btree ("email_c","deleted_at");--> statement-breakpoint
CREATE INDEX "user_account_id_deleted_at_created_at_idx" ON "user" USING btree ("account_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "user_email_c_user_status_id_deleted_at_idx" ON "user" USING btree ("email_c","user_status_id","deleted_at");--> statement-breakpoint
CREATE INDEX "user_user_id_deleted_at_idx" ON "user" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "user_user_id_account_id_user_status_id_deleted_at_idx" ON "user" USING btree ("user_id","account_id","user_status_id","deleted_at");--> statement-breakpoint
CREATE INDEX "user_status_name_idx" ON "user_status" USING btree ("name");--> statement-breakpoint
CREATE INDEX "user_address_user_id_idx" ON "user_address" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_address_country_id_idx" ON "user_address" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "user_address_city_fiscal_code_idx" ON "user_address" USING btree ("city_fiscal_code");--> statement-breakpoint
CREATE INDEX "user_address_state_fiscal_code_idx" ON "user_address" USING btree ("state_fiscal_code");--> statement-breakpoint
CREATE INDEX "user_address_deleted_at_idx" ON "user_address" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "user_address_user_id_deleted_at_idx" ON "user_address" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "user_document_user_document_type_id_idx" ON "user_document" USING btree ("user_document_type_id");--> statement-breakpoint
CREATE INDEX "user_document_user_id_idx" ON "user_document" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_document_document_partial_idx" ON "user_document" USING btree ("document_partial");--> statement-breakpoint
CREATE INDEX "user_document_user_id_user_document_type_id_idx" ON "user_document" USING btree ("user_id","user_document_type_id");--> statement-breakpoint
CREATE INDEX "user_document_document_c_idx" ON "user_document" USING btree ("document_c");--> statement-breakpoint
CREATE INDEX "user_document_type_name_idx" ON "user_document_type" USING btree ("name");--> statement-breakpoint
CREATE INDEX "user_info_user_id_idx" ON "user_info" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_info_phone_partial_idx" ON "user_info" USING btree ("phone_partial");--> statement-breakpoint
CREATE INDEX "user_info_deleted_at_idx" ON "user_info" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "user_info_user_id_deleted_at_idx" ON "user_info" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "user_info_phone_c_deleted_at_idx" ON "user_info" USING btree ("phone_c","deleted_at");--> statement-breakpoint
CREATE INDEX "user_card_user_id_idx" ON "user_card" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_card_deleted_at_idx" ON "user_card" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "user_card_user_id_deleted_at_idx" ON "user_card" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "user_card_user_id_default_idx" ON "user_card" USING btree ("user_id","default");--> statement-breakpoint
CREATE INDEX "user_customer_user_id_idx" ON "user_customer" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_channel_user_id_idx" ON "user_channel" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_channel_channel_id_idx" ON "user_channel" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "user_channel_account_id_idx" ON "user_channel" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "user_channel_user_id_channel_id_idx" ON "user_channel" USING btree ("user_id","channel_id");--> statement-breakpoint
CREATE INDEX "user_channel_user_id_account_id_idx" ON "user_channel" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "user_channel_account_id_channel_id_idx" ON "user_channel" USING btree ("account_id","channel_id");--> statement-breakpoint
CREATE INDEX "server_server_status_id_idx" ON "server" USING btree ("server_status_id");--> statement-breakpoint
CREATE INDEX "server_deleted_at_idx" ON "server" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "server_deleted_at_server_status_id_idx" ON "server" USING btree ("deleted_at","server_status_id");--> statement-breakpoint
CREATE INDEX "server_ssh_server_id_idx" ON "server_ssh" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "server_ssh_deleted_at_idx" ON "server_ssh" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "server_ssh_ssh_ip_idx" ON "server_ssh" USING btree ("ssh_ip");--> statement-breakpoint
CREATE INDEX "server_ssh_server_id_deleted_at_idx" ON "server_ssh" USING btree ("server_id","deleted_at");--> statement-breakpoint
CREATE INDEX "server_status_status_idx" ON "server_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX "server_web_server_id_idx" ON "server_web" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "server_web_deleted_at_idx" ON "server_web" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "server_web_server_id_deleted_at_idx" ON "server_web" USING btree ("server_id","deleted_at");--> statement-breakpoint
CREATE INDEX "server_web_web_domain_idx" ON "server_web" USING btree ("web_domain");--> statement-breakpoint
CREATE INDEX "permission_action_permission_module_id_idx" ON "permission_action" USING btree ("permission_module_id");--> statement-breakpoint
CREATE INDEX "permission_action_permission_action_group_id_idx" ON "permission_action" USING btree ("permission_action_group_id");--> statement-breakpoint
CREATE INDEX "permission_action_groups_name_idx" ON "permission_action_groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX "permission_action_groups_action_idx" ON "permission_action_groups" USING btree ("action");--> statement-breakpoint
CREATE INDEX "permission_role_account_id_idx" ON "permission_role" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "permission_role_deleted_at_idx" ON "permission_role" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "permission_role_account_id_deleted_at_idx" ON "permission_role" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "permission_role_name_idx" ON "permission_role" USING btree ("name");--> statement-breakpoint
CREATE INDEX "permission_module_module_idx" ON "permission_module" USING btree ("module");--> statement-breakpoint
CREATE INDEX "permission_assignment_permission_role_id_idx" ON "permission_assignment" USING btree ("permission_role_id");--> statement-breakpoint
CREATE INDEX "permission_assignment_user_id_idx" ON "permission_assignment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "permission_assignment_account_id_idx" ON "permission_assignment" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "permission_assignment_user_id_permission_role_id_idx" ON "permission_assignment" USING btree ("user_id","permission_role_id");--> statement-breakpoint
CREATE INDEX "permission_assignment_account_id_permission_role_id_idx" ON "permission_assignment" USING btree ("account_id","permission_role_id");--> statement-breakpoint
CREATE INDEX "permission_role_action_permission_action_id_idx" ON "permission_role_action" USING btree ("permission_action_id");--> statement-breakpoint
CREATE INDEX "permission_role_action_permission_action_group_id_idx" ON "permission_role_action" USING btree ("permission_action_group_id");--> statement-breakpoint
CREATE INDEX "permission_role_action_permission_role_id_idx" ON "permission_role_action" USING btree ("permission_role_id");--> statement-breakpoint
CREATE INDEX "permission_role_action_permission_role_id_permission_action_group_id_idx" ON "permission_role_action" USING btree ("permission_role_id","permission_action_group_id");--> statement-breakpoint
CREATE INDEX "country_iso_code_idx" ON "country" USING btree ("iso_code");--> statement-breakpoint
CREATE INDEX "zipcode_state_id_country_idx" ON "zipcode_state" USING btree ("id_country");--> statement-breakpoint
CREATE INDEX "zipcode_state_fiscal_code_idx" ON "zipcode_state" USING btree ("fiscal_code");--> statement-breakpoint
CREATE INDEX "zipcode_state_abbreviation_idx" ON "zipcode_state" USING btree ("abbreviation");--> statement-breakpoint
CREATE INDEX "zipcode_city_id_country_idx" ON "zipcode_city" USING btree ("id_country");--> statement-breakpoint
CREATE INDEX "zipcode_city_id_zipcode_state_idx" ON "zipcode_city" USING btree ("id_zipcode_state");--> statement-breakpoint
CREATE INDEX "zipcode_city_fiscal_code_idx" ON "zipcode_city" USING btree ("fiscal_code");--> statement-breakpoint
CREATE INDEX "zipcode_district_id_country_idx" ON "zipcode_district" USING btree ("id_country");--> statement-breakpoint
CREATE INDEX "zipcode_district_id_zipcode_city_idx" ON "zipcode_district" USING btree ("id_zipcode_city");--> statement-breakpoint
CREATE INDEX "zipcode_district_id_zipcode_state_idx" ON "zipcode_district" USING btree ("id_zipcode_state");--> statement-breakpoint
CREATE INDEX "zipcode_id_country_idx" ON "zipcode" USING btree ("id_country");--> statement-breakpoint
CREATE INDEX "zipcode_id_zipcode_city_idx" ON "zipcode" USING btree ("id_zipcode_city");--> statement-breakpoint
CREATE INDEX "zipcode_id_zipcode_district_idx" ON "zipcode" USING btree ("id_zipcode_district");--> statement-breakpoint
CREATE INDEX "zipcode_id_zipcode_state_idx" ON "zipcode" USING btree ("id_zipcode_state");--> statement-breakpoint
CREATE INDEX "zipcode_zipcode_idx" ON "zipcode" USING btree ("zipcode");--> statement-breakpoint
CREATE INDEX "zipcode_fiscal_code_idx" ON "zipcode" USING btree ("fiscal_code");--> statement-breakpoint
CREATE INDEX "api_key_account_id_idx" ON "api_key" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "api_key_key_idx" ON "api_key" USING btree ("key");--> statement-breakpoint
CREATE INDEX "api_key_deleted_at_idx" ON "api_key" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "api_key_account_id_deleted_at_idx" ON "api_key" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "api_key_key_deleted_at_idx" ON "api_key" USING btree ("key","deleted_at");--> statement-breakpoint
CREATE INDEX "api_key_worker_id_idx" ON "api_key" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "api_key_worker_id_deleted_at_idx" ON "api_key" USING btree ("worker_id","deleted_at");--> statement-breakpoint
CREATE INDEX "api_key_worker_id_account_id_idx" ON "api_key" USING btree ("worker_id","account_id");--> statement-breakpoint
CREATE INDEX "api_key_worker_id_account_id_deleted_at_idx" ON "api_key" USING btree ("worker_id","account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "account_account_status_id_idx" ON "account" USING btree ("account_status_id");--> statement-breakpoint
CREATE INDEX "account_deleted_at_idx" ON "account" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "account_deleted_at_created_at_idx" ON "account" USING btree ("deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "account_account_status_id_created_at_idx" ON "account" USING btree ("account_status_id","created_at");--> statement-breakpoint
CREATE INDEX "account_status_name_idx" ON "account_status" USING btree ("name");--> statement-breakpoint
CREATE INDEX "account_info_account_id_idx" ON "account_info" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_info_deleted_at_idx" ON "account_info" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "account_info_account_id_deleted_at_idx" ON "account_info" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "account_payment_account_id_idx" ON "account_payment" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_payment_user_customer_id_idx" ON "account_payment" USING btree ("user_customer_id");--> statement-breakpoint
CREATE INDEX "account_payment_plan_id_idx" ON "account_payment" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "account_payment_payment_billing_type_id_idx" ON "account_payment" USING btree ("payment_billing_type_id");--> statement-breakpoint
CREATE INDEX "account_payment_payment_status_id_idx" ON "account_payment" USING btree ("payment_status_id");--> statement-breakpoint
CREATE INDEX "account_payment_payment_date_idx" ON "account_payment" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "account_payment_payment_status_id_created_at_idx" ON "account_payment" USING btree ("payment_status_id","created_at");--> statement-breakpoint
CREATE INDEX "account_payment_plan_id_payment_status_id_created_at_idx" ON "account_payment" USING btree ("plan_id","payment_status_id","created_at");--> statement-breakpoint
CREATE INDEX "account_payment_payment_billing_type_id_payment_status_id_created_at_idx" ON "account_payment" USING btree ("payment_billing_type_id","payment_status_id","created_at");--> statement-breakpoint
CREATE INDEX "account_payment_cross_sell_plan_cross_sell_id_idx" ON "account_payment_cross_sell" USING btree ("plan_cross_sell_id");--> statement-breakpoint
CREATE INDEX "account_payment_cross_sell_account_payment_id_idx" ON "account_payment_cross_sell" USING btree ("account_payment_id");--> statement-breakpoint
CREATE INDEX "account_payment_nfse_account_payment_id_idx" ON "account_payment_nfse" USING btree ("account_payment_id");--> statement-breakpoint
CREATE INDEX "account_payment_nfse_account_payment_nfse_status_id_idx" ON "account_payment_nfse" USING btree ("account_payment_nfse_status_id");--> statement-breakpoint
CREATE INDEX "account_payment_nfse_nfse_id_idx" ON "account_payment_nfse" USING btree ("nfse_id");--> statement-breakpoint
CREATE INDEX "account_payment_nfse_status_name_idx" ON "account_payment_nfse_status" USING btree ("name");--> statement-breakpoint
CREATE INDEX "billing_period_name_idx" ON "billing_period" USING btree ("name");--> statement-breakpoint
CREATE INDEX "payment_billing_type_name_idx" ON "payment_billing_type" USING btree ("name");--> statement-breakpoint
CREATE INDEX "payment_status_name_idx" ON "payment_status" USING btree ("name");--> statement-breakpoint
CREATE INDEX "account_test_document_idx" ON "account_test" USING btree ("document");--> statement-breakpoint
CREATE INDEX "account_test_phone_idx" ON "account_test" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "account_test_email_idx" ON "account_test" USING btree ("email");--> statement-breakpoint
CREATE INDEX "worker_worker_status_id_idx" ON "worker" USING btree ("worker_status_id");--> statement-breakpoint
CREATE INDEX "worker_worker_type_id_idx" ON "worker" USING btree ("worker_type_id");--> statement-breakpoint
CREATE INDEX "worker_server_id_idx" ON "worker" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "worker_account_id_idx" ON "worker" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "worker_deleted_at_idx" ON "worker" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "worker_account_id_deleted_at_idx" ON "worker" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "worker_account_id_deleted_at_created_at_idx" ON "worker" USING btree ("account_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "worker_status_status_idx" ON "worker_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX "worker_type_type_idx" ON "worker_type" USING btree ("type");--> statement-breakpoint
CREATE INDEX "worker_phone_connection_worker_id_idx" ON "worker_phone_connection" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_phone_connection_number_idx" ON "worker_phone_connection" USING btree ("number");--> statement-breakpoint
CREATE INDEX "worker_config_status_status_idx" ON "worker_config_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX "worker_config_type_type_idx" ON "worker_config_type" USING btree ("type");--> statement-breakpoint
CREATE INDEX "worker_config_worker_id_idx" ON "worker_config" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_config_worker_config_status_id_idx" ON "worker_config" USING btree ("worker_config_status_id");--> statement-breakpoint
CREATE INDEX "worker_config_worker_config_type_id_idx" ON "worker_config" USING btree ("worker_config_type_id");--> statement-breakpoint
CREATE INDEX "worker_config_chatbot_id_idx" ON "worker_config" USING btree ("chatbot_id");--> statement-breakpoint
CREATE INDEX "worker_config_worker_id_worker_config_type_id_idx" ON "worker_config" USING btree ("worker_id","worker_config_type_id");--> statement-breakpoint
CREATE INDEX "worker_config_worker_id_chatbot_id_idx" ON "worker_config" USING btree ("worker_id","chatbot_id");--> statement-breakpoint
CREATE INDEX "worker_profile_status_worker_id_idx" ON "worker_profile_status" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_profile_status_worker_profile_status_type_id_idx" ON "worker_profile_status" USING btree ("worker_profile_status_type_id");--> statement-breakpoint
CREATE INDEX "worker_profile_status_type_type_idx" ON "worker_profile_status_type" USING btree ("type");--> statement-breakpoint
CREATE INDEX "worker_profile_info_worker_id_idx" ON "worker_profile_info" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_profile_status_contact_worker_profile_status_id_idx" ON "worker_profile_status_contact" USING btree ("worker_profile_status_id");--> statement-breakpoint
CREATE INDEX "worker_profile_status_contact_contact_id_idx" ON "worker_profile_status_contact" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "plan_status_idx" ON "plan" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plan_deleted_at_idx" ON "plan" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "plan_deleted_at_status_idx" ON "plan" USING btree ("deleted_at","status");--> statement-breakpoint
CREATE INDEX "plan_deleted_at_is_exclusive_idx" ON "plan" USING btree ("deleted_at","is_exclusive");--> statement-breakpoint
CREATE INDEX "plan_deleted_at_status_is_exclusive_idx" ON "plan" USING btree ("deleted_at","status","is_exclusive");--> statement-breakpoint
CREATE INDEX "plan_is_test_idx" ON "plan" USING btree ("is_test");--> statement-breakpoint
CREATE INDEX "plan_product_name_idx" ON "plan_product" USING btree ("name");--> statement-breakpoint
CREATE INDEX "plan_product_description_plan_product_id_idx" ON "plan_product_description" USING btree ("plan_product_id");--> statement-breakpoint
CREATE INDEX "plan_items_plan_product_id_idx" ON "plan_items" USING btree ("plan_product_id");--> statement-breakpoint
CREATE INDEX "plan_items_plan_id_idx" ON "plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_items_deleted_at_idx" ON "plan_items" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "plan_items_plan_id_deleted_at_idx" ON "plan_items" USING btree ("plan_id","deleted_at");--> statement-breakpoint
CREATE INDEX "plan_cross_sell_plan_product_id_idx" ON "plan_cross_sell" USING btree ("plan_product_id");--> statement-breakpoint
CREATE INDEX "plan_cross_sell_deleted_at_idx" ON "plan_cross_sell" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "plan_cross_sell_plan_product_id_plan_cross_sell_id_idx" ON "plan_cross_sell" USING btree ("plan_product_id","plan_cross_sell_id");--> statement-breakpoint
CREATE INDEX "plan_cross_sell_account_plan_cross_sell_id_idx" ON "plan_cross_sell_account" USING btree ("plan_cross_sell_id");--> statement-breakpoint
CREATE INDEX "plan_cross_sell_account_account_id_idx" ON "plan_cross_sell_account" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "plan_cross_sell_account_deleted_at_idx" ON "plan_cross_sell_account" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "plan_cross_sell_account_account_id_deleted_at_idx" ON "plan_cross_sell_account" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "plan_cross_sell_account_account_id_plan_cross_sell_id_deleted_at_idx" ON "plan_cross_sell_account" USING btree ("account_id","plan_cross_sell_id","deleted_at");--> statement-breakpoint
CREATE INDEX "plan_account_account_id_idx" ON "plan_account" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "plan_account_plan_id_idx" ON "plan_account" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_account_account_payment_id_idx" ON "plan_account" USING btree ("account_payment_id");--> statement-breakpoint
CREATE INDEX "plan_account_billing_period_id_idx" ON "plan_account" USING btree ("billing_period_id");--> statement-breakpoint
CREATE INDEX "plan_account_next_payment_date_idx" ON "plan_account" USING btree ("next_payment_date");--> statement-breakpoint
CREATE INDEX "plan_account_account_id_next_payment_date_idx" ON "plan_account" USING btree ("account_id","next_payment_date");--> statement-breakpoint
CREATE INDEX "plan_account_account_id_cancellation_date_idx" ON "plan_account" USING btree ("account_id","cancellation_date");--> statement-breakpoint
CREATE INDEX "plan_account_account_id_next_payment_date_cancellation_date_idx" ON "plan_account" USING btree ("account_id","next_payment_date","cancellation_date");--> statement-breakpoint
CREATE INDEX "plan_account_recurring_payment_cancellation_date_next_payment_date_idx" ON "plan_account" USING btree ("recurring_payment","cancellation_date","next_payment_date");--> statement-breakpoint
CREATE INDEX "plan_account_exclusive_plan_id_idx" ON "plan_account_exclusive" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_account_exclusive_account_id_idx" ON "plan_account_exclusive" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "plan_account_exclusive_account_id_plan_id_idx" ON "plan_account_exclusive" USING btree ("account_id","plan_id");--> statement-breakpoint
CREATE INDEX "sector_sector_status_id_idx" ON "sector" USING btree ("sector_status_id");--> statement-breakpoint
CREATE INDEX "sector_account_id_idx" ON "sector" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sector_deleted_at_idx" ON "sector" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "sector_account_id_deleted_at_idx" ON "sector" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "sector_status_name_idx" ON "sector_status" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sector_user_sector_id_idx" ON "sector_user" USING btree ("sector_id");--> statement-breakpoint
CREATE INDEX "sector_user_user_id_idx" ON "sector_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sector_user_deleted_at_idx" ON "sector_user" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "sector_user_user_id_deleted_at_idx" ON "sector_user" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "sector_user_sector_id_user_id_idx" ON "sector_user" USING btree ("sector_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_user_user_id_idx" ON "chat_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chatbot_account_id_idx" ON "chatbot" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "chatbot_name_idx" ON "chatbot" USING btree ("name");--> statement-breakpoint
CREATE INDEX "message_template_account_id_idx" ON "message_template" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "message_template_message_status_id_idx" ON "message_template" USING btree ("message_status_id");--> statement-breakpoint
CREATE INDEX "message_template_command_idx" ON "message_template" USING btree ("command");--> statement-breakpoint
CREATE INDEX "message_template_deleted_at_idx" ON "message_template" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "message_template_account_id_deleted_at_idx" ON "message_template" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "message_status_name_idx" ON "message_status" USING btree ("name");--> statement-breakpoint
CREATE INDEX "label_template_account_id_idx" ON "label_template" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "label_template_label_status_id_idx" ON "label_template" USING btree ("label_status_id");--> statement-breakpoint
CREATE INDEX "label_template_deleted_at_idx" ON "label_template" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "label_template_account_id_deleted_at_idx" ON "label_template" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "label_status_name_idx" ON "label_status" USING btree ("name");--> statement-breakpoint
CREATE INDEX "contact_user_id_idx" ON "contact" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contact_account_id_idx" ON "contact" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contact_contact_document_type_id_idx" ON "contact" USING btree ("contact_document_type_id");--> statement-breakpoint
CREATE INDEX "contact_email_partial_idx" ON "contact" USING btree ("email_partial");--> statement-breakpoint
CREATE INDEX "contact_phone_partial_idx" ON "contact" USING btree ("phone_partial");--> statement-breakpoint
CREATE INDEX "contact_document_partial_idx" ON "contact" USING btree ("document_partial");--> statement-breakpoint
CREATE INDEX "contact_deleted_at_idx" ON "contact" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "contact_account_id_deleted_at_idx" ON "contact" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "contact_account_id_email_c_deleted_at_idx" ON "contact" USING btree ("account_id","email_c","deleted_at");--> statement-breakpoint
CREATE INDEX "contact_account_id_phone_c_deleted_at_idx" ON "contact" USING btree ("account_id","phone_c","deleted_at");--> statement-breakpoint
CREATE INDEX "contact_account_id_is_valided_deleted_at_idx" ON "contact" USING btree ("account_id","is_valided","deleted_at");--> statement-breakpoint
CREATE INDEX "contact_account_id_deleted_at_created_at_idx" ON "contact" USING btree ("account_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "contact_group_account_id_idx" ON "contact_group" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contact_group_deleted_at_idx" ON "contact_group" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "contact_group_account_id_deleted_at_idx" ON "contact_group" USING btree ("account_id","deleted_at");--> statement-breakpoint
CREATE INDEX "contact_group_assignment_contact_id_idx" ON "contact_group_assignment" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_group_assignment_contact_group_id_idx" ON "contact_group_assignment" USING btree ("contact_group_id");--> statement-breakpoint
CREATE INDEX "contact_group_assignment_contact_group_id_contact_id_idx" ON "contact_group_assignment" USING btree ("contact_group_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_document_type_name_idx" ON "contact_document_type" USING btree ("name");--> statement-breakpoint
CREATE INDEX "contact_label_template_contact_id_idx" ON "contact_label_template" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_label_template_label_template_id_idx" ON "contact_label_template" USING btree ("label_template_id");--> statement-breakpoint
CREATE INDEX "contact_label_template_contact_id_label_template_id_idx" ON "contact_label_template" USING btree ("contact_id","label_template_id");--> statement-breakpoint
CREATE INDEX "expenditure_deleted_at_idx" ON "expenditure" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "expenditure_deleted_at_created_at_idx" ON "expenditure" USING btree ("deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "expenditure_created_at_idx" ON "expenditure" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_worker_id_idx" ON "notifications" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "notifications_notification_type_id_idx" ON "notifications" USING btree ("notification_type_id");--> statement-breakpoint
CREATE INDEX "notifications_deleted_at_idx" ON "notifications" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "notifications_notification_type_id_deleted_at_idx" ON "notifications" USING btree ("notification_type_id","deleted_at");--> statement-breakpoint
CREATE INDEX "notifications_worker_id_deleted_at_idx" ON "notifications" USING btree ("worker_id","deleted_at");--> statement-breakpoint
CREATE INDEX "notification_type_name_idx" ON "notification_type" USING btree ("name");--> statement-breakpoint
CREATE INDEX "nfse_external_id_idx" ON "nfse" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "nfse_default_product_idx" ON "nfse" USING btree ("default_product");--> statement-breakpoint
CREATE INDEX "report_conversation_history_pdf_account_id_idx" ON "report_conversation_history_pdf" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "report_conversation_history_pdf_chat_id_idx" ON "report_conversation_history_pdf" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "report_conversation_history_pdf_status_idx" ON "report_conversation_history_pdf" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_conversation_history_pdf_account_id_status_idx" ON "report_conversation_history_pdf" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "report_conversation_history_pdf_account_id_chat_id_idx" ON "report_conversation_history_pdf" USING btree ("account_id","chat_id");--> statement-breakpoint
CREATE INDEX "scheduled_contact_schedule_id_idx" ON "scheduled_contact" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "scheduled_contact_contact_group_id_idx" ON "scheduled_contact" USING btree ("contact_group_id");--> statement-breakpoint
CREATE INDEX "scheduled_contact_contact_id_idx" ON "scheduled_contact" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "scheduled_contact_schedule_id_contact_id_idx" ON "scheduled_contact" USING btree ("schedule_id","contact_id");--> statement-breakpoint
CREATE INDEX "schedule_account_id_idx" ON "schedule" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "schedule_worker_id_idx" ON "schedule" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "schedule_send_date_idx" ON "schedule" USING btree ("send_date");--> statement-breakpoint
CREATE INDEX "schedule_status_idx" ON "schedule" USING btree ("status");--> statement-breakpoint
CREATE INDEX "schedule_account_id_status_idx" ON "schedule" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "schedule_status_send_date_idx" ON "schedule" USING btree ("status","send_date");--> statement-breakpoint
CREATE INDEX "schedule_status_send_date_created_at_idx" ON "schedule" USING btree ("status","send_date","created_at");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_token_idx" ON "two_factor" USING btree ("token");--> statement-breakpoint
CREATE INDEX "two_factor_code_idx" ON "two_factor" USING btree ("code");--> statement-breakpoint
CREATE INDEX "two_factor_deleted_at_idx" ON "two_factor" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "two_factor_email_c_phone_c_code_deleted_at_idx" ON "two_factor" USING btree ("email_c","phone_c","code","deleted_at");--> statement-breakpoint
CREATE INDEX "two_factor_email_c_phone_c_token_idx" ON "two_factor" USING btree ("email_c","phone_c","token");--> statement-breakpoint
CREATE INDEX "credit_card_fee_deleted_at_idx" ON "credit_card_fee" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "method_payment_type_idx" ON "method_payment" USING btree ("type");--> statement-breakpoint
CREATE INDEX "method_payment_status_idx" ON "method_payment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "method_payment_created_at_idx" ON "method_payment" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_agent_type_name_idx" ON "ai_agent_type" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ai_agent_account_id_idx" ON "ai_agent" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ai_agent_ai_agent_type_id_idx" ON "ai_agent" USING btree ("ai_agent_type_id");--> statement-breakpoint
CREATE INDEX "ai_agent_status_idx" ON "ai_agent" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_agent_account_id_status_idx" ON "ai_agent" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "ai_agent_embedding_model_idx" ON "ai_agent" USING btree ("embedding_model");--> statement-breakpoint
CREATE INDEX "ai_agent_model_idx" ON "ai_agent" USING btree ("model");--> statement-breakpoint
CREATE INDEX "ai_agent_voice_ia_id_idx" ON "ai_agent" USING btree ("voice_ia_id");--> statement-breakpoint
CREATE INDEX "ai_agent_prompt_ai_agent_id_idx" ON "ai_agent_prompt" USING btree ("ai_agent_id");--> statement-breakpoint
CREATE INDEX "ai_agent_prompt_status_idx" ON "ai_agent_prompt" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_agent_prompt_ai_agent_id_status_idx" ON "ai_agent_prompt" USING btree ("ai_agent_id","status");--> statement-breakpoint
CREATE INDEX "ai_agent_usage_ai_agent_id_idx" ON "ai_agent_usage" USING btree ("ai_agent_id");--> statement-breakpoint
CREATE INDEX "ai_agent_usage_account_id_idx" ON "ai_agent_usage" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ai_agent_usage_created_at_idx" ON "ai_agent_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_agent_usage_ai_agent_id_created_at_idx" ON "ai_agent_usage" USING btree ("ai_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_agent_human_transfer_target_ai_agent_id_idx" ON "ai_agent_human_transfer_target" USING btree ("ai_agent_id");--> statement-breakpoint
CREATE INDEX "ai_agent_human_transfer_target_account_id_idx" ON "ai_agent_human_transfer_target" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ai_agent_human_transfer_target_ai_agent_id_account_id_idx" ON "ai_agent_human_transfer_target" USING btree ("ai_agent_id","account_id");--> statement-breakpoint
CREATE INDEX "voice_ia_account_id_idx" ON "voice_ia" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "voice_ia_status_idx" ON "voice_ia" USING btree ("status");--> statement-breakpoint
CREATE INDEX "push_subscription_user_id_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscription_deleted_at_idx" ON "push_subscription" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "push_subscription_user_id_deleted_at_idx" ON "push_subscription" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "release_account_id_idx" ON "release" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "release_created_by_user_id_idx" ON "release" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "release_type_idx" ON "release" USING btree ("type");--> statement-breakpoint
CREATE INDEX "release_status_idx" ON "release" USING btree ("status");--> statement-breakpoint
CREATE INDEX "release_account_id_status_idx" ON "release" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "release_access_release_id_idx" ON "release_access" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_access_account_id_idx" ON "release_access" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "release_access_user_id_idx" ON "release_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "release_access_permission_role_id_idx" ON "release_access" USING btree ("permission_role_id");--> statement-breakpoint
CREATE INDEX "release_view_release_id_idx" ON "release_view" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_view_user_id_idx" ON "release_view" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "release_view_release_id_user_id_idx" ON "release_view" USING btree ("release_id","user_id");