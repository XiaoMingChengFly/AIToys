CREATE TABLE "node_task" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"node_key" text NOT NULL,
	"name" text NOT NULL,
	"assignee_id" text,
	"due_date" timestamp with time zone,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node_task" ADD CONSTRAINT "node_task_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_task" ADD CONSTRAINT "node_task_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_task" ADD CONSTRAINT "node_task_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_task" ADD CONSTRAINT "node_task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_task_work_item" ON "node_task" USING btree ("work_item_id","node_key");--> statement-breakpoint
CREATE INDEX "node_task_assignee" ON "node_task" USING btree ("assignee_id");