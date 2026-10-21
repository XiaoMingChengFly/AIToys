import type { NodeDefinition } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { type FieldConfig, FieldInput, type FieldInputValue, type FieldMember } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";

/** 有完成表单的节点：确认完成前先在弹窗里填表单，提交时字段值和确认一起写入。 */
export function CompleteNodeDialog({
  workItemId,
  node,
  fields,
  values,
  members,
  open,
  onOpenChange,
}: {
  workItemId: string;
  node: NodeDefinition;
  fields: readonly FieldConfig[];
  values: ReadonlyMap<string, unknown>;
  members: readonly FieldMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, FieldInputValue>>(() =>
    Object.fromEntries((node.form ?? []).map(({ field }) => [field, (values.get(field) ?? null) as FieldInputValue])),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = Object.fromEntries(
      Object.entries(draft).map(([key, v]) => [key, typeof v === "string" ? v.trim() || null : v]),
    );
    setError(null);
    setBusy(true);
    const { client, server } = zero.mutate(mutators.node.confirm({ workItemId, nodeKey: node.key, values: submitted }));
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setBusy(false);
        return setError(outcome.error.message);
      }
    setBusy(false);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent title={`完成节点：${node.name}`} description="填写节点的完成表单，带 * 的必须填。">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          {(node.form ?? []).map(({ field: key, required }) => {
            const field = fields.find((f) => f.key === key);
            const label = (
              <>
                {field?.name ?? key}
                {required && <span className="ml-0.5 text-danger-600">*</span>}
              </>
            );
            return (
              <Field key={key} label={label}>
                <FieldInput
                  field={field ?? { key, name: key, dataType: "text", options: null }}
                  value={draft[key] ?? null}
                  members={members}
                  live
                  required={required}
                  onChange={(v) => setDraft((prev) => ({ ...prev, [key]: v }))}
                />
              </Field>
            );
          })}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              确认完成
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
