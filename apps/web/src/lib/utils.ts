import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 客户端生成的主键。Zero 的乐观写入不用等服务端分配 id。 */
export function newId(): string {
  return crypto.randomUUID();
}
