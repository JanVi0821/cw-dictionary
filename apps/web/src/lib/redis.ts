import "server-only";

import type { RedisClientType } from "redis";
import { captureError } from "@/lib/sentry";

const COLLECTION_TTL_SECONDS = 60 * 60 * 48;

let client: RedisClientType | undefined;
let connecting: Promise<RedisClientType | null> | undefined;
let reportedMissingConfig = false;

function reportRedis(error: unknown, stage: string) {
  return captureError(error, {
    tags: { area: "redis", stage },
    extra: {
      host: process.env.REDIS_HOST ?? null,
      port: process.env.REDIS_PORT ?? null,
    },
    redact: process.env.REDIS_PASSWORD ? [process.env.REDIS_PASSWORD] : [],
  });
}

async function ready() {
  const host = process.env.REDIS_HOST;
  const password = process.env.REDIS_PASSWORD;
  if (!host || !password) {
    if (!reportedMissingConfig) {
      reportedMissingConfig = true;
      await reportRedis(new Error("Redis environment variables are not set"), "config");
    }
    return null;
  }
  if (client?.isOpen) return client;

  connecting ??= (async () => {
    try {
      const { createClient } = await import("redis");
      const next = createClient({
        username: process.env.REDIS_USERNAME || "default",
        password,
        socket: {
          host,
          port: Number(process.env.REDIS_PORT || 10261),
          connectTimeout: 2000,
        },
      });
      next.on("error", (error) => {
        void reportRedis(error, "client");
      });
      await next.connect();
      client = next;
      return next;
    } catch (error) {
      connecting = undefined;
      await reportRedis(error, "connect");
      return null;
    }
  })();

  return connecting;
}

export async function cachedCollection<T>(key: string, load: () => Promise<T>) {
  const current = await ready();
  if (!current) return load();

  try {
    const hit = await current.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch (error) {
    await reportRedis(error, "get");
    return load();
  }

  const value = await load();
  try {
    await current.set(key, JSON.stringify(value), { EX: COLLECTION_TTL_SECONDS });
  } catch (error) {
    await reportRedis(error, "set");
  }
  return value;
}
