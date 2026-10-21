/** 每个查询和 mutator 都拿到的上下文。userID 来自登录会话，由服务端在 /api/zero/* 里填入。 */
export interface ZeroContext {
  userID: string;
}

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    context: ZeroContext;
  }
}
