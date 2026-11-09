export type AppMode = "guest" | "local" | "cloud";
export function initialAppMode(staticSite: boolean, configuredMode?: string): AppMode {
  if (configuredMode === "cloud") return "cloud";
  if (configuredMode === "guest" || staticSite) return "guest";
  return "local";
}
