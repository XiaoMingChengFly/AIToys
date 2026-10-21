CREATE TABLE "field_viewer" (
	"work_item_id" text NOT NULL,
	"field_key" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "field_viewer_work_item_id_field_key_user_id_pk" PRIMARY KEY("work_item_id","field_key","user_id")
);
--> statement-breakpoint
ALTER TABLE "field_def" ADD COLUMN "view_roles" jsonb;--> statement-breakpoint
ALTER TABLE "field_def" ADD COLUMN "edit_roles" jsonb;--> statement-breakpoint
ALTER TABLE "field_value" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "space_member" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "field_viewer" ADD CONSTRAINT "field_viewer_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_viewer" ADD CONSTRAINT "field_viewer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "space_member" SET "role" = 'admin' WHERE "is_admin";--> statement-breakpoint
ALTER TABLE "space_member" DROP COLUMN "is_admin";