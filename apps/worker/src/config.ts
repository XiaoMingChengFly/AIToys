/** 运行配置，全部来自环境变量，默认值对应本机 docker compose。 */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://feishu:feishu@localhost:5432/feishu",
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "fp-events",
};
