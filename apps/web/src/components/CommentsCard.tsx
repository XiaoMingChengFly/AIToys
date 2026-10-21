import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn, newId } from "@/lib/utils";

interface CommentRow {
  id: string;
  body: string;
  createdAt: number | null;
  author?: { name: string } | null;
}

/** 工作项评论（放在详情页侧栏“评论”页签里）：按时间排列，可以提及空间成员，被提及的人会收到通知。 */
export function CommentsCard({
  workItemId,
  comments,
  members,
}: {
  workItemId: string;
  comments: readonly CommentRow[];
  members: { userId: string; name: string }[];
}) {
  const zero = useZero();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const others = members.filter((m) => m.userId !== zero.userID);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const { client, server } = zero.mutate(mutators.comment.create({ id: newId(), workItemId, body, mentions }));
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
    setBody("");
    setMentions([]);
  }

  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 && <p className="text-fg-subtle">还没有评论。</p>}
      <ol aria-label="评论列表" className="flex flex-col gap-4">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <Avatar name={c.author?.name ?? "?"} size={28} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{c.author?.name ?? "—"}</span>
                <span className="text-xs text-fg-subtle">
                  {c.createdAt ? new Date(c.createdAt).toLocaleString("zh-CN") : ""}
                </span>
              </div>
              <p className="break-words whitespace-pre-wrap">{c.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <form className="flex flex-col gap-2" onSubmit={submit}>
        <Textarea
          aria-label="评论内容"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="写评论…"
        />
        <div className="flex items-start gap-2">
          {others.length > 0 && (
            <div className="flex flex-1 flex-wrap items-center gap-1">
              <span className="text-xs text-fg-subtle">提及</span>
              {others.map((m) => {
                const on = mentions.includes(m.userId);
                return (
                  <button
                    key={m.userId}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setMentions((prev) => (on ? prev.filter((u) => u !== m.userId) : [...prev, m.userId]))
                    }
                    className={cn(
                      "h-6 cursor-pointer rounded-md px-1.5 text-xs transition-colors",
                      on ? "bg-brand-100 text-brand-600" : "text-fg-muted hover:bg-hover",
                    )}
                  >
                    @{m.name}
                  </button>
                );
              })}
            </div>
          )}
          <Button type="submit" size="sm" className="ml-auto" disabled={!body.trim()}>
            发表评论
          </Button>
        </div>
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </form>
    </div>
  );
}
