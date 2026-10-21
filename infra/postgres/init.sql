-- 首次启动时执行：应用库、Temporal 用户、pgvector 扩展
CREATE ROLE temporal WITH LOGIN PASSWORD 'temporal' CREATEDB;
CREATE DATABASE feishu;
\c feishu
CREATE EXTENSION IF NOT EXISTS vector;
