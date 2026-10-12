import {
  CACHE_LOCK_WAIT_MS,
  GLOBAL_CACHE_MAX_CHARS,
  LANG,
  PROVIDER,
  REDIS_NAMESPACE,
  VERSION,
} from "./config.ts";
import { acquireRedisLock, type RedisConnection } from "./redis.ts";
import type { TranslateText } from "./types.ts";

/** Redis Hash 的 field 仅为小写原文，不拼接上下文或文本 hash。 */
export const cacheKey = (text: string) => text.toLowerCase();
export const redisCacheName = `${REDIS_NAMESPACE}:cache:${PROVIDER}:${LANG}:v${VERSION}`;

// 校验文本锁后写入缓存，保留首次成功写入的译文。
const COMMIT = `
if redis.call('GET',KEYS[1]) ~= ARGV[1] then return false end
redis.call('HSETNX',KEYS[2],ARGV[2],ARGV[3])
return redis.call('HGET',KEYS[2],ARGV[2])`;

/** Redis 即时读写；相同短文本通过锁合并在途 API 请求。 */
export function createCachedTranslator(
  translate: TranslateText,
  redis: RedisConnection,
  assertRunning: () => void,
) {
  const cached: TranslateText = async (text, context) => {
    assertRunning();
    const eligible =
      GLOBAL_CACHE_MAX_CHARS > 0 &&
      Array.from(text).length <= GLOBAL_CACHE_MAX_CHARS;
    if (!eligible) {
      const result = await translate(text, context);
      assertRunning();
      return result;
    }
    const field = cacheKey(text);
    const hit = await redis.hGet(redisCacheName, field);
    if (hit !== null) return hit;
    const lock = await acquireRedisLock(
      redis,
      `${redisCacheName}:lock:${encodeURIComponent(field)}`,
      CACHE_LOCK_WAIT_MS,
    );
    try {
      // 等待文本锁期间，全局运行锁或其他 worker 的状态可能已经变化。
      assertRunning();
      // 等待锁期间其他 worker 可能已写入译文，必须再次查询。
      const existing = await redis.hGet(redisCacheName, field);
      if (existing !== null) return existing;
      const result = await translate(text, context);
      if (!result.trim()) throw new Error(`Empty translation: ${context.path}`);
      assertRunning();
      lock.assertOwned();
      const saved = await redis.eval(COMMIT, {
        keys: [lock.key, redisCacheName],
        arguments: [lock.token, field, result],
      });
      if (typeof saved !== "string")
        throw new Error("Redis cache lock lost before write");
      return saved;
    } finally {
      await lock.release();
    }
  };
  return { translate: cached };
}
