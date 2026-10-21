CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_work_item" ON "attachment" USING btree ("work_item_id","created_at");