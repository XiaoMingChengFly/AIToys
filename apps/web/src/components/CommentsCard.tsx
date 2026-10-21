import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { newId } from "@/lib/utils";

interface CommentRow {
  id: string;
  body: string;
  createdAt: number | null;
  author?: { name: string } | null;
}

/** 工作项评论：按时间排列，可以提及空间成员，被提及的人会收到通知。 */
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
    <Card>
      <CardHeader>
        <CardTitle>评论</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {comments.length === 0 && <p className="text-sm text-slate-500">还没有评论。</p>}
        <ol aria-label="评论列表" className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{c.author?.name ?? "—"}</span>
                <span>{c.createdAt ? new Date(c.createdAt).toLocaleString("zh-CN") : ""}</span>
              </div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ol>
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <textarea
            aria-label="评论内容"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            placeholder="写评论…"
          />
          {others.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500">提及：</span>
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
                    className={`rounded-full px-2 py-0.5 ${on ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"}`}
                  >
                    @{m.name}
                  </button>
                );
              })}
            </div>
          )}
          <Button type="submit" className="self-end" disabled={!body.trim()}>
            发表评论
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
