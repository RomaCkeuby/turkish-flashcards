import { defineConfig, loadEnv } from "vite";
import { validateBrowserEnvironment, validateCloudConfig } from "./src/cloud/config";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  validateBrowserEnvironment(env);
  const staticSite = mode === "static" || env.VITE_STATIC_SITE === "1";
  const appMode = mode === "cloud" ? "cloud" : staticSite ? "guest" : env.VITE_APP_MODE || "local";
  if (!["guest", "local", "cloud"].includes(appMode)) throw new Error("Unknown VITE_APP_MODE");
  if (staticSite && appMode === "cloud") throw new Error("Cloud and static builds must be separate");
  if (appMode === "cloud") validateCloudConfig(env, command === "serve");
  return {
    base: env.VITE_BASE_PATH || "/",
    define: { "import.meta.env.VITE_APP_MODE": JSON.stringify(appMode),
      ...(staticSite ? { "import.meta.env.VITE_STATIC_SITE": JSON.stringify("1") } : {}) },
    build: { outDir: appMode === "cloud" ? "dist-cloud" : staticSite ? "dist-static" : "dist" },
    server: {
      proxy: { "/api": "http://127.0.0.1:3001" },
    },
  };
});
