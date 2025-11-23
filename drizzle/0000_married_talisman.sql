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
	"zip_code" varchar(10) NOT NULL,
	"address1" varchar(1000) NOT NULL,
	"address1_partial" varchar(200) NOT NULL,
	"address1_c" varchar(500) NOT NULL,
	"address2" varchar(1000),
	"address2_partial" varchar(200),
	"address2_c" varchar(500),
	"city" varchar(100) NOT NULL,
	"state" varchar(100) NOT NULL,
	"district" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_document" (
	"user_document_id" uuid PRIMARY KEY NOT NULL,
	"user_document_type_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"document" varchar(500) NOT NULL,
	"document_partial" varchar(50) NOT NULL,
	"document_c" varchar(500) NOT NULL,
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
	"phone_ddi" varchar(5) NOT NULL,
	"phone" varchar(500) NOT NULL,
	"phone_partial" varchar(15) NOT NULL,
	"phone_c" varchar(500) NOT NULL,
	"photo" varchar(255),
	"name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"birth_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
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
	"key" varchar(32) NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"account_status_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" varchar(10) NOT NULL,
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
CREATE TABLE "worker_config" (
	"worker_config_id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"is_automatic_attendance" boolean DEFAULT false,
	"show_attendee_name" boolean DEFAULT false,
	"show_worker_name" boolean DEFAULT false,
	"generate_protocol_at_ura" boolean DEFAULT false,
	"generate_protocol_at_start" boolean DEFAULT false,
	"generate_protocol_at_transfer" boolean DEFAULT false,
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
CREATE TABLE "sector" (
	"sector_id" uuid PRIMARY KEY NOT NULL,
	"sector_status_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(20) NOT NULL,
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
CREATE TABLE "sector_role" (
	"sector_role_id" uuid PRIMARY KEY NOT NULL,
	"sector_id" uuid NOT NULL,
	"permission_role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_user" (
	"chat_user_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"about" varchar(200),
	"status" varchar(100),
	"notifications" boolean DEFAULT true,
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
	"label_template_id" uuid,
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
	"birthday" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
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
ALTER TABLE "user" ADD CONSTRAINT "user_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_user_status_id_user_status_user_status_id_fk" FOREIGN KEY ("user_status_id") REFERENCES "public"."user_status"("user_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_address" ADD CONSTRAINT "user_address_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_address" ADD CONSTRAINT "user_address_country_id_country_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."country"("country_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_document" ADD CONSTRAINT "user_document_user_document_type_id_user_document_type_user_document_type_id_fk" FOREIGN KEY ("user_document_type_id") REFERENCES "public"."user_document_type"("user_document_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_document" ADD CONSTRAINT "user_document_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_info" ADD CONSTRAINT "user_info_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "account" ADD CONSTRAINT "account_account_status_id_account_status_account_status_id_fk" FOREIGN KEY ("account_status_id") REFERENCES "public"."account_status"("account_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_plan_id_plan_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_info" ADD CONSTRAINT "account_info_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_worker_status_id_worker_status_worker_status_id_fk" FOREIGN KEY ("worker_status_id") REFERENCES "public"."worker_status"("worker_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_worker_type_id_worker_type_worker_type_id_fk" FOREIGN KEY ("worker_type_id") REFERENCES "public"."worker_type"("worker_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_server_id_server_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("server_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_phone_connection" ADD CONSTRAINT "worker_phone_connection_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_config" ADD CONSTRAINT "worker_config_worker_id_worker_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("worker_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "sector" ADD CONSTRAINT "sector_sector_status_id_sector_status_sector_status_id_fk" FOREIGN KEY ("sector_status_id") REFERENCES "public"."sector_status"("sector_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector" ADD CONSTRAINT "sector_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_role" ADD CONSTRAINT "sector_role_sector_id_sector_sector_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sector"("sector_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_role" ADD CONSTRAINT "sector_role_permission_role_id_permission_role_permission_role_id_fk" FOREIGN KEY ("permission_role_id") REFERENCES "public"."permission_role"("permission_role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_user" ADD CONSTRAINT "chat_user_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_message_status_id_message_status_message_status_id_fk" FOREIGN KEY ("message_status_id") REFERENCES "public"."message_status"("message_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_template" ADD CONSTRAINT "label_template_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_template" ADD CONSTRAINT "label_template_label_status_id_label_status_label_status_id_fk" FOREIGN KEY ("label_status_id") REFERENCES "public"."label_status"("label_status_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_label_template_id_label_template_label_template_id_fk" FOREIGN KEY ("label_template_id") REFERENCES "public"."label_template"("label_template_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group" ADD CONSTRAINT "contact_group_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_assignment" ADD CONSTRAINT "contact_group_assignment_contact_id_contact_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("contact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group_assignment" ADD CONSTRAINT "contact_group_assignment_contact_group_id_contact_group_contact_group_id_fk" FOREIGN KEY ("contact_group_id") REFERENCES "public"."contact_group"("contact_group_id") ON DELETE no action ON UPDATE no action;