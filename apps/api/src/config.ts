/** 运行配置，全部来自环境变量，默认值对应本机开发。 */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://feishu:feishu@localhost:5432/feishu",
  /** 对外地址，登录回调和 cookie 用。 */
  baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  authSecret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-in-production",
  /** 允许跨域带 cookie 访问的前端地址，逗号分隔。 */
  webOrigins: (process.env.WEB_ORIGINS ?? "http://localhost:5173").split(","),
};
