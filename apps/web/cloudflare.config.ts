import { bindings, defineConfig, defineWorker } from "cf/config";
import { createWorkersResponseStoreSelfContainedConfig } from "@vinext/cloudflare/cache/config";

const WORKER_NAME = "cw-dictionary";

const cache = await createWorkersResponseStoreSelfContainedConfig({
  worker: WORKER_NAME,
  bucket: `${WORKER_NAME}-response-cache-bodies`,
});

export default defineConfig({
  worker: defineWorker({
    ...cache,
    name: WORKER_NAME,
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-14",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    assets: { notFoundHandling: "none" },
    env: {
      ...cache.env,
      ASSETS: bindings.assets(),
    },
  }),
});
