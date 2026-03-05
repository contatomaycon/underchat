CREATE TABLE "user_attendance_hours_rule" (
  "user_id" uuid NOT NULL,
  "weekday" varchar(20) NOT NULL,
  "start_time" varchar(5) NOT NULL,
  "end_time" varchar(5) NOT NULL,
  "created_at" timestamp with time zone NULL DEFAULT now(),
  "updated_at" timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT "user_attendance_hours_rule_user_id_weekday_start_time_end_time_pk" PRIMARY KEY ("user_id", "weekday", "start_time", "end_time"),
  CONSTRAINT "user_attendance_hours_rule_user_id_user_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user" ("user_id") ON DELETE CASCADE
);
CREATE INDEX "user_attendance_hours_rule_user_id_idx" ON "user_attendance_hours_rule" ("user_id");
CREATE INDEX "user_attendance_hours_rule_user_id_weekday_idx" ON "user_attendance_hours_rule" ("user_id", "weekday");
