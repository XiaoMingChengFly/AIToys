/** 每个查询和 mutator 都拿到的上下文。userID 来自登录会话，由服务端在 /api/zero/* 里填入。 */
export interface ZeroContext {
  userID: string;
  /** 由自动化执行时，触发它的那条事件。写出的事件带上它，自动化不会再被这些事件触发。 */
  causedBy?: number;
}

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    context: ZeroContext;
  }
}
