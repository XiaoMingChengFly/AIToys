ALTER TABLE "event_log" ADD COLUMN "field_key" text;--> statement-breakpoint
UPDATE "event_log" SET "field_key" = "payload"->>'fieldKey' WHERE "kind" = 'fieldChanged';
