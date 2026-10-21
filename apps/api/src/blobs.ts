import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/**
 * 文件存储。附件这类二进制内容不进数据库，数据库里只记存储键。
 * 现在的实现存在本机目录（Docker Compose 部署时挂一个卷）；换成对象存储时实现同一个接口即可。
 */
export interface BlobStore {
  put(key: string, body: ReadableStream<Uint8Array>): Promise<number>;
  /** 文件不存在时返回 null。 */
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  delete(key: string): Promise<void>;
}

export function fileBlobStore(root: string): BlobStore {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    if (!path.startsWith(base + sep)) throw new Error(`非法的存储键：${key}`);
    return path;
  };
  return {
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), createWriteStream(path));
      return (await stat(path)).size;
    },
    async get(key) {
      const path = pathOf(key);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) return null;
      return { body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, size: info.size };
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
