import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/utils";

export function SpacesPage() {
  const zero = useZero();
  const [spaces] = useQuery(queries.spaces.mine());
  const [name, setName] = useState("");

  function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    zero.mutate(mutators.space.create({ id: newId(), name: name.trim() }));
    setName("");
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">我的空间</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {spaces.map((space) => (
          <Link key={space.id} to="/spaces/$spaceId" params={{ spaceId: space.id }}>
            <Card className="transition-colors hover:border-sky-400">
              <CardHeader>
                <CardTitle>{space.name}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
        {spaces.length === 0 && <p className="text-sm text-slate-500">还没有空间，先建一个。</p>}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>新建空间</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex gap-2" onSubmit={create}>
            <Input
              aria-label="空间名称"
              placeholder="空间名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit">创建</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
