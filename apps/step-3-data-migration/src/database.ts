import { createAdminClient } from "@supabase/server/core";
import type { SupabaseContext } from "@supabase/server";
import { ENV, SCHEMA } from "./config.ts";

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} missing`);
  return value;
}

export function createSupabaseClient(): SupabaseContext["supabaseAdmin"] {
  const secret = requiredEnv(ENV.secretKey);
  if (!secret.startsWith("sb_secret_"))
    throw new Error(`${ENV.secretKey} must be a Supabase secret key`);
  // 项目 supabase-server skill 推荐的服务端客户端，内部通过 supabase-js 调用 Data API。
  // 显式映射 NEXT_PUBLIC_SUPABASE_URL；不创建用户会话、不校验用户 JWT。
  return createAdminClient({
    env: {
      url: requiredEnv(ENV.supabaseUrl),
      secretKeys: { default: secret },
    },
    supabaseOptions: { db: { schema: SCHEMA } },
  });
}

export function reportError(error: unknown) {
  let message =
    error instanceof Error ? error.message : "Unknown migration error";
  for (const name of Object.values(ENV)) {
    const value = process.env[name];
    if (!value) continue;
    message = message.replaceAll(value, "[redacted]");
    try {
      const password = new URL(value).password;
      if (password) {
        message = message.replaceAll(password, "[redacted]");
        message = message.replaceAll(
          decodeURIComponent(password),
          "[redacted]",
        );
      }
    } catch {
      /* 非 URL 连接串只按完整值脱敏。 */
    }
  }
  console.error(message);
  process.exitCode = 1;
}
