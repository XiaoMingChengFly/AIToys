import { mutators, schema } from "@fp/sync";
import { ZeroProvider } from "@rocicorp/zero/react";
import type { ReactNode } from "react";
import { env } from "./env.ts";

/**
 * 登录后的数据层。浏览器本地有一份同步的数据，读写都先在本地完成，zero-cache 负责和服务端同步。
 * 登录态靠 cookie：zero-cache 把它转给 API，API 从会话里解析用户。
 */
export function ZeroRoot({ userID, children }: { userID: string; children: ReactNode }) {
  return (
    <ZeroProvider cacheURL={env.zeroUrl} userID={userID} schema={schema} mutators={mutators} context={{ userID }}>
      {children}
    </ZeroProvider>
  );
}
