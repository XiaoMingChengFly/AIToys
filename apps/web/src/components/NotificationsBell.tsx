import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

/** 顶栏的通知入口：未读数、最近的通知，点一条跳到工作项并标为已读。 */
export function NotificationsBell() {
  const zero = useZero();
  const navigate = useNavigate();
  const [notifications] = useQuery(queries.notifications.mine());
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => n.readAt == null);

  const markRead = (ids: string[]) => {
    if (ids.length > 0) zero.mutate(mutators.notification.markRead({ ids }));
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unread.length > 0 ? `通知（${unread.length} 条未读）` : "通知"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="relative rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
      >
        通知
        {unread.length > 0 && (
          <span className="ml-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{unread.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-medium">通知</span>
            {unread.length > 0 && (
              <button
                type="button"
                className="text-xs text-sky-700 hover:underline"
                onClick={() => markRead(unread.map((n) => n.id))}
              >
                全部已读
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">没有通知。</p>
          ) : (
            <ul aria-label="通知列表" className="max-h-96 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${n.readAt == null ? "font-medium" : "text-slate-500"}`}
                    onClick={() => {
                      markRead(n.readAt == null ? [n.id] : []);
                      setOpen(false);
                      if (n.workItemId) navigate({ to: "/items/$itemId", params: { itemId: n.workItemId } });
                    }}
                  >
                    {n.text}
                    <span className="block text-xs font-normal text-slate-400">
                      {new Date(n.createdAt ?? 0).toLocaleString("zh-CN")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
