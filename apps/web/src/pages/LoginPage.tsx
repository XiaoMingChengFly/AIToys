import { Navigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth";

export function LoginPage() {
  // 登录成功后 Better Auth 会刷新会话，拿到会话就进入应用
  const { data: session } = authClient.useSession();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setError(null);
    const { error } =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name")) });
    setBusy(false);
    if (error) setError(error.message ?? "登录失败。");
  }

  if (session) return <Navigate to="/" />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "signIn" ? "登录" : "注册"}</CardTitle>
          <p className="text-sm text-slate-500">飞书项目复刻</p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {mode === "signUp" && (
              <Label className="flex flex-col gap-1.5">
                姓名
                <Input name="name" required autoComplete="name" />
              </Label>
            )}
            <Label className="flex flex-col gap-1.5">
              邮箱
              <Input name="email" type="email" required autoComplete="email" />
            </Label>
            <Label className="flex flex-col gap-1.5">
              密码
              <Input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              />
            </Label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy}>
              {mode === "signIn" ? "登录" : "注册并登录"}
            </Button>
            <Button type="button" variant="link" onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
              {mode === "signIn" ? "没有账号？注册" : "已有账号？登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
