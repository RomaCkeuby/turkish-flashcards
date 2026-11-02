import type { PublicCardEntry, PublicDeckManifest } from "./publicDeckTypes";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

export function parsePublicManifest(value: unknown): PublicDeckManifest {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.version !== "string" || !value.version
    || !Number.isSafeInteger(value.recordCount) || (value.recordCount as number) < 0
    || typeof value.file !== "string" || !/^cards\.[a-f0-9]{16}\.json$/.test(value.file)
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error("Формат подборки несовместим с этой версией сайта.");
  }
  return value as PublicDeckManifest;
}

export function parsePublicEntries(value: unknown, expectedCount: number): PublicCardEntry[] {
  const keys = new Set<string>();
  if (!Array.isArray(value) || value.length !== expectedCount) throw new Error("Подборка загружена не полностью.");
  for (const entry of value) {
    if (!object(entry) || !["key", "turkish", "russian", "partOfSpeech", "category", "exampleTurkish", "exampleRussian"].every(field => typeof entry[field] === "string")
      || !entry.key || !entry.turkish || !entry.russian || keys.has(entry.key as string) || !strings(entry.tags)
      || !Array.isArray(entry.sources) || !entry.sources.every(source => object(source)
        && typeof source.name === "string" && typeof source.url === "string" && typeof source.license === "string"
        && ["entry", "example", "exampleTranslation"].includes(String(source.purpose))
        && (!source.url || /^https?:\/\//i.test(source.url) || source.url === "local://curated-basic-v1"))) {
      throw new Error("Подборка содержит некорректные карточки.");
    }
    keys.add(entry.key as string);
  }
  return value as PublicCardEntry[];
}

export async function loadPublicDeck(baseUrl: string, fetcher: typeof fetch = fetch) {
  const root = `${baseUrl.replace(/\/$/, "")}/decks/`;
  const manifestResponse = await fetcher(`${root}manifest.json`, { cache: "no-cache" });
  if (!manifestResponse.ok) throw new Error("Не удалось загрузить подборку. Проверьте интернет и повторите.");
  const manifest = parsePublicManifest(await manifestResponse.json());
  const response = await fetcher(`${root}${manifest.file}`);
  if (!response.ok) throw new Error("Файл карточек недоступен. Повторите загрузку.");
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== manifest.sha256) throw new Error("Проверка подборки не пройдена. Повторите загрузку.");
  const entries = parsePublicEntries(JSON.parse(new TextDecoder().decode(bytes)), manifest.recordCount);
  return { manifest, entries };
}
