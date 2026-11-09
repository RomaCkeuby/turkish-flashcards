import { createClient } from "@supabase/supabase-js";
import { validateCloudConfig } from "./config";

const config = validateCloudConfig(import.meta.env, import.meta.env.DEV);
export const cloud = createClient(config.url, config.key, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});
