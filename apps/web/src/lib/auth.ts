import { createAuthClient } from "better-auth/react";
import { env } from "./env.ts";

export const authClient = createAuthClient({ baseURL: env.apiUrl });
