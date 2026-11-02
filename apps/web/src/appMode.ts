export type AppMode = "guest" | "server";
export function initialAppMode(staticSite: boolean): AppMode { return staticSite ? "guest" : "server"; }
