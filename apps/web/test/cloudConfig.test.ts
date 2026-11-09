import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCloudConfig } from "../src/cloud/config.ts";
import { initialAppMode } from "../src/appMode.ts";
import { clearPersonalStorage } from "../src/cloud/personalStorage.ts";

const env = { VITE_SUPABASE_URL: "https://test-project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
test("cloud build rejects private keys, home API targets and non-Supabase endpoints", () => {
  assert.equal(validateCloudConfig(env).url, "https://test-project.supabase.co");
  for (const extra of [{ VITE_SERVICE_ROLE_KEY: "secret" }, { VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_123" },
    { VITE_API_URL: "https://home.trycloudflare.com/api" }, { VITE_SUPABASE_URL: "http://localhost:54321" },
    { VITE_SUPABASE_URL: "https://supabase.co.evil.example" }]) assert.throws(() => validateCloudConfig({ ...env, ...extra }));
  const token = `eyJ.${btoa(JSON.stringify({ role: "service_role" }))}.signature`;
  assert.throws(() => validateCloudConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: token }));
  assert.equal(validateCloudConfig({ ...env, VITE_SUPABASE_URL: "http://127.0.0.1:54321" }, true).url, "http://127.0.0.1:54321");
  assert.equal(initialAppMode(true, "cloud"), "cloud");
  assert.equal(initialAppMode(false, "guest"), "guest");
});

test("switching users removes drafts, study tokens and pending requests while preserving guest data", () => {
  const items = new Map([["turkish-flashcards.draft.42", "private"], ["turkish-flashcards.study.v1", "private"],
    ["turkish-flashcards.cloud.pending.a", "private"], ["guest.deck", "public"]]);
  const storage = { get length() { return items.size; }, key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => items.delete(key) };
  clearPersonalStorage(storage as Storage);
  assert.deepEqual([...items], [["guest.deck", "public"]]);
});
