ALTER TABLE "relation" ALTER COLUMN "relation_def_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relation" ADD COLUMN "parent_node_key" text;--> statement-breakpoint
CREATE INDEX "relation_from" ON "relation" USING btree ("from_id");