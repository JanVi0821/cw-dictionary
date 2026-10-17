import "server-only";

import { captureError } from "@/lib/sentry";

function cacheStorage() {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

function reportCacheError(error: unknown, stage: "match" | "put", request: Request) {
  void captureError(error, {
    tags: { area: "cache", stage },
    extra: { url: request.url },
  });
}

export async function withCache(request: Request, load: () => Promise<Response>) {
  const cache = cacheStorage();
  const cacheable = cache !== undefined && request.method === "GET";

  if (cacheable) {
    try {
      const hit = await cache.match(request);
      if (hit) return hit;
    } catch (error) {
      reportCacheError(error, "match", request);
    }
  }

  const response = await load();
  if (!cacheable || response.status !== 200) return response;

  try {
    await cache.put(request, response.clone());
  } catch (error) {
    reportCacheError(error, "put", request);
  }
  return response;
}
