export function validateBrowserEnvironment(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_") || !value) continue;
    if (/SECRET|SERVICE.?ROLE|PASSWORD|PRIVATE|TOKEN/i.test(name) || value.startsWith("sb_secret_")) {
      throw new Error(`Секрет ${name} запрещено включать в браузерную сборку.`);
    }
    if (value.startsWith("eyJ")) {
      try {
        const encoded = value.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/");
        if (JSON.parse(atob(encoded)).role === "service_role") throw new Error("service_role");
      } catch (error) {
        if (error instanceof Error && error.message === "service_role") throw new Error(`Service role key в ${name} запрещён.`);
      }
    }
  }
}
export function validateCloudConfig(env: Record<string, string | undefined>, allowLocal = false) {
  validateBrowserEnvironment(env);
  if (env.VITE_API_URL) throw new Error("Облачный режим не использует VITE_API_URL домашнего сервера.");
  const url = new URL(env.VITE_SUPABASE_URL || "invalid:");
  const local = allowLocal && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((!local && (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co"))) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Задайте HTTPS URL проекта Supabase в VITE_SUPABASE_URL.");
  }
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!key.startsWith("sb_publishable_") && !key.startsWith("eyJ")) {
    throw new Error("Задайте публичный publishable/anon key Supabase.");
  }
  // Legacy anon JWT is useful for the local Supabase CLI, but a privileged JWT must never be accepted.
  if (key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(atob(key.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/")));
      if (payload.role !== "anon") throw new Error();
    } catch { throw new Error("Допустим только публичный anon JWT."); }
  }
  return { url: url.origin, key };
}
