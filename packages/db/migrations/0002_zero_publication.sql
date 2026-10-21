-- Zero 只复制这个 publication 里的表。按 schema 发布，以后 public 里新建的业务表自动纳入；
-- infra 里的内部表（outbox、登录会话、向量等）不会进入 Zero。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'zero_pub') THEN
    CREATE PUBLICATION zero_pub FOR TABLES IN SCHEMA public;
  END IF;
END
$$;
