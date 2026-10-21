import { type FieldDataType, fieldIndex, normalizeFieldValue } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { assertSpaceMembers } from "./access.ts";
import { zql } from "./schema.gen.ts";

/** 类型上的字段定义；字段不存在时抛错。 */
export async function fieldDefOf(tx: Transaction, typeId: string, fieldKey: string) {
  const field = await tx.run(zql.fieldDef.where("typeId", typeId).where("key", fieldKey).one());
  if (!field) throw new Error(`字段「${fieldKey}」不存在。`);
  return field;
}

/**
 * 写一个字段值：按字段类型校验并整理成规范形式（人员字段还要是空间成员），
 * 同时维护检索列（num、str 和 field_value_item），列表筛选靠它们。返回旧值和写入的值。
 */
export async function writeFieldValue(
  tx: Transaction,
  item: { id: string; typeId: string; spaceId: string },
  fieldKey: string,
  input: unknown,
): Promise<{ from: unknown; to: unknown; created: boolean }> {
  const field = await fieldDefOf(tx, item.typeId, fieldKey);
  const value = normalizeFieldValue(field, input);
  if (field.dataType === "user" && Array.isArray(value))
    await assertSpaceMembers(tx, item.spaceId, value.map(String), `「${field.name}」只能选空间成员。`);
  return storeFieldValue(tx, item.id, field, value);
}

/** 写入已经整理好的值，并维护检索列。公式字段的计算结果也走这里，记上计算时间。 */
export async function storeFieldValue(
  tx: Transaction,
  workItemId: string,
  field: { key: string; name: string; dataType: FieldDataType },
  value: unknown,
): Promise<{ from: unknown; to: unknown; created: boolean }> {
  const fieldKey = field.key;
  const before = await tx.run(zql.fieldValue.where("workItemId", workItemId).where("fieldKey", fieldKey).one());
  const index = fieldIndex(field, value);
  const now = Date.now();
  await tx.mutate.fieldValue.upsert({
    workItemId,
    fieldKey,
    value,
    num: index.num,
    str: index.str,
    ...(field.dataType === "formula" && { computedAt: now }),
    updatedAt: now,
  });
  const existing = await tx.run(zql.fieldValueItem.where("workItemId", workItemId).where("fieldKey", fieldKey));
  for (const row of existing)
    if (!index.items.includes(row.item))
      await tx.mutate.fieldValueItem.delete({ workItemId, fieldKey, item: row.item });
  for (const v of index.items)
    if (!existing.some((row) => row.item === v))
      await tx.mutate.fieldValueItem.upsert({ workItemId, fieldKey, item: v });
  return { from: before?.value ?? null, to: value, created: !before };
}
