import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { responseStoreAdapter } from "@vinext/cloudflare/cache/response-store-adapter";

export default defineConfig(({ command, isPreview }) => {
  const useCloudflare = command === "build" || isPreview;

  return {
    server: {
      port: 3000,
    },
    optimizeDeps: {
      exclude: ["lucide-react", "next-intl"],
    },
    build: {
      rolldownOptions: {
        external: ["cloudflare:workers"],
      },
    },
    plugins: [
      tailwindcss(),
      vinext(
        useCloudflare
          ? { cache: responseStoreAdapter({ mode: "self-contained" }) }
          : undefined,
      ),
      ...(useCloudflare
        ? [
            cloudflare({
              viteEnvironment: {
                name: "rsc",
                childEnvironments: ["ssr"],
              },
            }),
          ]
        : []),
    ],
  };
});
