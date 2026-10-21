import type { Database } from "@fp/db";
import { queries, schema } from "@fp/sync";
import { mustGetMutator, mustGetQuery } from "@rocicorp/zero";
import { handleMutateRequest, handleQueryRequest } from "@rocicorp/zero/server";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import { serverMutators } from "./server-mutators.ts";

/**
 * zero-cache 把浏览器的查询和写操作转发到这里（ZERO_QUERY_URL / ZERO_MUTATE_URL），并带上浏览器的 cookie。
 * userID 由调用方从登录会话里解析好传进来。
 */
export function createZeroHandlers(database: Database) {
  const zqlDb = zeroDrizzle(schema, database.db);

  return {
    query(request: Request, userID: string) {
      return handleQueryRequest({
        schema,
        request,
        userID,
        handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx: { userID } }),
      });
    },

    mutate(request: Request, userID: string) {
      return handleMutateRequest({
        dbProvider: zqlDb,
        request,
        userID,
        handler: (transact) =>
          transact((tx, name, args) => mustGetMutator(serverMutators, name).fn({ tx, args, ctx: { userID } })),
      });
    },

    /** 不经过 HTTP 直接在一个服务端事务里执行 mutator。测试和服务端内部调用用。 */
    run(name: string, args: unknown, userID: string) {
      return zqlDb.transaction((tx) =>
        mustGetMutator(serverMutators, name).fn({ tx, args: args as never, ctx: { userID } }),
      );
    },
  };
}
