import "server-only";

import type { RedisClientType } from "redis";

const COLLECTION_TTL_SECONDS = 60 * 60 * 48;

let client: RedisClientType | undefined;
let connecting: Promise<RedisClientType | null> | undefined;

async function ready() {
  const host = process.env.REDIS_HOST;
  const password = process.env.REDIS_PASSWORD;
  if (!host || !password) return null;
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
        console.error("Redis Client Error", error);
      });
      await next.connect();
      client = next;
      return next;
    } catch (error) {
      connecting = undefined;
      console.error("Redis Client Error", error);
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
    console.error("Redis Client Error", error);
    return load();
  }

  const value = await load();
  try {
    await current.set(key, JSON.stringify(value), { EX: COLLECTION_TTL_SECONDS });
  } catch (error) {
    console.error("Redis Client Error", error);
  }
  return value;
}
