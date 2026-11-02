import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const staticSite = mode === "static" || env.VITE_STATIC_SITE === "1";
  return {
    base: env.VITE_BASE_PATH || "/",
    define: staticSite ? { "import.meta.env.VITE_STATIC_SITE": JSON.stringify("1") } : {},
    build: { outDir: staticSite ? "dist-static" : "dist" },
    server: {
      proxy: { "/api": "http://127.0.0.1:3001" },
    },
  };
});
