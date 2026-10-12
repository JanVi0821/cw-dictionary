import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "redis";
import { REDIS_LOCK_TTL_MS } from "./config.ts";

export type RedisConnection = ReturnType<typeof createRedisConnection>;
export function createRedisConnection() {
  const client = createClient({
    url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    socket: { connectTimeout: 5000, reconnectStrategy: false },
    disableOfflineQueue: true,
  });
  client.on("error", () => console.error("Redis connection error"));
  return client;
}

const UNLOCK =
  "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
const RENEW =
  "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";

/** 带令牌及自动续期的锁；释放时只删除自己持有的锁。 */
export async function acquireRedisLock(
  redis: RedisConnection,
  key: string,
  waitMs = 0,
) {
  const token = randomUUID();
  const started = Date.now();
  let deadline = 0;
  for (;;) {
    const requested = Date.now();
    if (await redis.set(key, token, { NX: true, PX: REDIS_LOCK_TTL_MS })) {
      deadline = requested + REDIS_LOCK_TTL_MS;
      break;
    }
    if (Date.now() - started >= waitMs)
      throw new Error("Redis lock unavailable or wait timeout");
    await delay(100);
  }
  let failure: Error | undefined;
  let renewing = Promise.resolve();
  const timer = setInterval(
    () => {
      renewing = renewing
        .then(async () => {
          if (failure) return;
          const requested = Date.now();
          if (requested >= deadline) throw new Error("Redis lock expired");
          const result = await redis.eval(RENEW, {
            keys: [key],
            arguments: [token, String(REDIS_LOCK_TTL_MS)],
          });
          if (result !== 1) throw new Error("Redis lock ownership lost");
          deadline = requested + REDIS_LOCK_TTL_MS;
        })
        .catch(() => {
          failure = new Error("Redis lock renewal failed; task stopped");
        });
    },
    Math.floor(REDIS_LOCK_TTL_MS / 3),
  );
  timer.unref();
  function assertOwned() {
    if (failure) throw failure;
    if (Date.now() >= deadline)
      throw new Error("Redis lock expired; task stopped");
  }
  async function release() {
    clearInterval(timer);
    await renewing;
    if (redis.isReady)
      await redis.eval(UNLOCK, { keys: [key], arguments: [token] });
  }
  return { key, token, assertOwned, release };
}
