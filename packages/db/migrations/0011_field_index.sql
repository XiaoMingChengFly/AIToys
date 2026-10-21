CREATE TABLE "field_value_item" (
	"work_item_id" text NOT NULL,
	"field_key" text NOT NULL,
	"item" text NOT NULL,
	CONSTRAINT "field_value_item_work_item_id_field_key_item_pk" PRIMARY KEY("work_item_id","field_key","item")
);
--> statement-breakpoint
ALTER TABLE "field_value" ADD COLUMN "num" double precision;--> statement-breakpoint
ALTER TABLE "field_value" ADD COLUMN "str" text;--> statement-breakpoint
ALTER TABLE "field_value_item" ADD CONSTRAINT "field_value_item_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_value_item_lookup" ON "field_value_item" USING btree ("field_key","item");--> statement-breakpoint
-- 关联走关联定义（relation_def），字段类型里的“关联”按文本处理
UPDATE "field_def" SET "data_type" = 'text' WHERE "data_type" = 'relation';--> statement-breakpoint
-- 回填已有字段值的检索列
UPDATE "field_value" fv SET "str" = fv."value" #>> '{}'
FROM "work_item" w, "field_def" f
WHERE w."id" = fv."work_item_id" AND f."type_id" = w."type_id" AND f."key" = fv."field_key"
  AND f."data_type" IN ('text', 'link', 'date') AND jsonb_typeof(fv."value") = 'string';--> statement-breakpoint
UPDATE "field_value" fv SET "num" = (fv."value" #>> '{}')::double precision
FROM "work_item" w, "field_def" f
WHERE w."id" = fv."work_item_id" AND f."type_id" = w."type_id" AND f."key" = fv."field_key"
  AND f."data_type" = 'number' AND jsonb_typeof(fv."value") = 'number';--> statement-breakpoint
INSERT INTO "field_value_item" ("work_item_id", "field_key", "item")
SELECT fv."work_item_id", fv."field_key", fv."value" #>> '{}'
FROM "field_value" fv
JOIN "work_item" w ON w."id" = fv."work_item_id"
JOIN "field_def" f ON f."type_id" = w."type_id" AND f."key" = fv."field_key"
WHERE f."data_type" IN ('select', 'bool') AND jsonb_typeof(fv."value") IN ('string', 'boolean')
ON CONFLICT DO NOTHING;
