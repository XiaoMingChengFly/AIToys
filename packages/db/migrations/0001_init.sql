CREATE SCHEMA "infra";
--> statement-breakpoint
CREATE TABLE "infra"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb,
	"actions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "automation_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rule_id" text NOT NULL,
	"event_id" bigint NOT NULL,
	"workflow_id" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"space_id" text NOT NULL,
	"work_item_id" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" text,
	"caused_by" bigint,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_def" (
	"id" text PRIMARY KEY NOT NULL,
	"type_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"data_type" text NOT NULL,
	"options" jsonb,
	"formula" text,
	"required" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_value" (
	"work_item_id" text NOT NULL,
	"field_key" text NOT NULL,
	"value" jsonb,
	"computed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_value_work_item_id_field_key_pk" PRIMARY KEY("work_item_id","field_key")
);
--> statement-breakpoint
CREATE TABLE "flow_template" (
	"id" text PRIMARY KEY NOT NULL,
	"type_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"current_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_version" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_confirmation" (
	"node_instance_id" text NOT NULL,
	"user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_confirmation_node_instance_id_user_id_pk" PRIMARY KEY("node_instance_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "node_instance" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"node_key" text NOT NULL,
	"state" text DEFAULT 'notStarted' NOT NULL,
	"owners" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"actual_start" timestamp with time zone,
	"actual_end" timestamp with time zone,
	"planned_pinned" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra"."outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "infra"."outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" bigint NOT NULL,
	"stream" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "relation" (
	"id" text PRIMARY KEY NOT NULL,
	"relation_def_id" text NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relation_def" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"from_type_id" text NOT NULL,
	"to_type_id" text NOT NULL,
	"field_key" text NOT NULL,
	"name" text NOT NULL,
	"cardinality" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_def" (
	"id" text PRIMARY KEY NOT NULL,
	"type_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"inherit_from" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_member" (
	"work_item_id" text NOT NULL,
	"role_key" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "role_member_work_item_id_role_key_user_id_pk" PRIMARY KEY("work_item_id","role_key","user_id")
);
--> statement-breakpoint
CREATE TABLE "infra"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "space" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_member" (
	"space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "space_member_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "infra"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"type_id" text NOT NULL,
	"flow_version_id" text,
	"name" text NOT NULL,
	"stage" text,
	"status" text DEFAULT 'inProgress' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra"."work_item_embedding" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_type" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"flow_mode" text DEFAULT 'node' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "infra"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_event_id_event_log_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_def" ADD CONSTRAINT "field_def_type_id_work_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_item_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_template" ADD CONSTRAINT "flow_template_type_id_work_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_item_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_version" ADD CONSTRAINT "flow_version_template_id_flow_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."flow_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_version" ADD CONSTRAINT "flow_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_confirmation" ADD CONSTRAINT "node_confirmation_node_instance_id_node_instance_id_fk" FOREIGN KEY ("node_instance_id") REFERENCES "public"."node_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_confirmation" ADD CONSTRAINT "node_confirmation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_instance" ADD CONSTRAINT "node_instance_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."outbox" ADD CONSTRAINT "outbox_event_id_event_log_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_relation_def_id_relation_def_id_fk" FOREIGN KEY ("relation_def_id") REFERENCES "public"."relation_def"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_from_id_work_item_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_to_id_work_item_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_def" ADD CONSTRAINT "relation_def_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_def" ADD CONSTRAINT "relation_def_from_type_id_work_item_type_id_fk" FOREIGN KEY ("from_type_id") REFERENCES "public"."work_item_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_def" ADD CONSTRAINT "relation_def_to_type_id_work_item_type_id_fk" FOREIGN KEY ("to_type_id") REFERENCES "public"."work_item_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_def" ADD CONSTRAINT "role_def_type_id_work_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_item_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_member" ADD CONSTRAINT "role_member_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_member" ADD CONSTRAINT "role_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member" ADD CONSTRAINT "space_member_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member" ADD CONSTRAINT "space_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_type_id_work_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_item_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_flow_version_id_flow_version_id_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."flow_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."work_item_embedding" ADD CONSTRAINT "work_item_embedding_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."space"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_rule_event" ON "automation_run" USING btree ("rule_id","event_id");--> statement-breakpoint
CREATE INDEX "event_log_work_item" ON "event_log" USING btree ("work_item_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_def_type_key" ON "field_def" USING btree ("type_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_template_type_key" ON "flow_template" USING btree ("type_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_version_template_version" ON "flow_version" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "node_instance_work_item_node" ON "node_instance" USING btree ("work_item_id","node_key");--> statement-breakpoint
CREATE INDEX "outbox_pending" ON "infra"."outbox" USING btree ("id") WHERE "infra"."outbox"."dispatched_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "relation_def_from_to" ON "relation" USING btree ("relation_def_id","from_id","to_id");--> statement-breakpoint
CREATE INDEX "relation_to" ON "relation" USING btree ("to_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_def_type_key" ON "role_def" USING btree ("type_id","key");--> statement-breakpoint
CREATE INDEX "work_item_space_type" ON "work_item" USING btree ("space_id","type_id");--> statement-breakpoint
CREATE INDEX "work_item_status" ON "work_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_item_embedding_hnsw" ON "infra"."work_item_embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_type_space_key" ON "work_item_type" USING btree ("space_id","key");