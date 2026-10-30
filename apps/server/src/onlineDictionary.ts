import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createUserEntry } from "./database.ts";
import { exampleContainsPhrase, searchTatoeba, type UsageExample } from "./tatoebaSearch.ts";

export type OnlineWord = {
  id: string;
  turkish: string;
  russian: string;
  partOfSpeech: string;
  exampleTurkish: string;
  exampleRussian: string;
  sourceUrl: string;
  sourceName: string;
  sourceLicense?: string;
  examples?: UsageExample[];
};
type Page = { title: string; missing?: boolean; revisions?: { slots: { main: { content: string } } }[] };
const pending = new Map<string, { word: OnlineWord; expires: number }>();

// Split only outside nested templates and links: their pipes belong to the nested value.
function templateParts(value: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const pair = value.slice(i, i + 2);
    if (pair === "{{" || pair === "[[") { depth++; i++; }
    else if (pair === "}}" || pair === "]]") { depth--; i++; }
    else if (value[i] === "|" && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}

function templates(value: string) {
  const results: string[][] = [];
  let start = -1;
  let depth = 0;
  for (let i = 0; i < value.length - 1; i++) {
    const pair = value.slice(i, i + 2);
    if (pair === "{{") { if (depth++ === 0) start = i + 2; i++; }
    else if (pair === "}}" && depth > 0) {
      if (--depth === 0) results.push(templateParts(value.slice(start, i)));
      i++;
    }
  }
  return results;
}

function plain(value: string) {
  let text = value.replace(/<!--[^]*?-->/g, "");
  for (let i = 0; i < 15 && /\{\{/.test(text); i++) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_whole, inner: string) => {
      const parts = templateParts(inner);
      return /^(выдел|ударение)$/i.test(parts[0]?.trim() ?? "") ? parts[1] ?? "" : "";
    });
  }
  return text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, label: string | undefined) => label ?? target)
    .replace(/<[^>]*>/g, "").replace(/'{2,}/g, "").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function languageSection(text: string, language: string) {
  const sections = text.split(/(?=^=\s*\{\{-[a-z-]+-\}\}\s*=\s*$)/m);
  return sections.find(section => new RegExp(`^=\\s*\\{\\{-${language}-\\}\\}\\s*=`, "m").test(section)) ?? "";
}

function partOfSpeech(section: string) {
  const names: Record<string, string> = { сущ: "существительное", гл: "глагол", прил: "прилагательное", нареч: "наречие", мест: "местоимение" };
  const kind = [...section.matchAll(/\{\{(сущ|гл|прил|нареч|мест)[ -]tr\b/gu)].at(-1)?.[1];
  return (kind ? names[kind] : undefined) ?? "слово";
}

export function parseDictionaryPage(title: string, text: string): Omit<OnlineWord, "id">[] {
  const source = { sourceName: "Викисловарь", sourceUrl: `https://ru.wiktionary.org/wiki/${encodeURIComponent(title)}` };
  const result: Omit<OnlineWord, "id">[] = [];
  const turkish = languageSection(text, "tr");
  // Each definition keeps its own example; examples from another sense are never joined.
  const meaningBlocks = turkish.split(/====\s*Значение\s*====/);
  for (let index = 1; index < meaningBlocks.length; index++) {
    const block = meaningBlocks[index] ?? "";
    const definitions = block.split(/^={2,}/m)[0] ?? "";
    const pos = partOfSpeech(meaningBlocks.slice(0, index).join("\n"));
    for (const line of definitions.split("\n").filter(line => /^#\s+[^#]/.test(line))) {
      const russian = plain(line.replace(/^#\s*/, ""));
      if (!/[а-яё]/i.test(russian) || russian.length > 600 || /\{\{|\}\}/.test(russian)) continue;
      const example = templates(line).find(parts => parts[0]?.trim() === "пример");
      const translation = example?.find(value => /^перевод\s*=/.test(value.trim()));
      const exampleTurkish = example ? plain(example[1] ?? "") : "";
      const exampleRussian = translation ? plain(translation.replace(/^\s*перевод\s*=/, "")) : "";
      result.push({ ...source, turkish: title, russian, partOfSpeech: pos,
        exampleTurkish: exampleRussian ? exampleTurkish : "", exampleRussian: exampleTurkish ? exampleRussian : "" });
    }
  }
  const russian = languageSection(text, "ru");
  for (const block of templates(russian).filter(parts => parts[0]?.trim() === "перев-блок")) {
    const translation = block.find(value => /^\s*tr\s*=/.test(value));
    if (!translation) continue;
    const value = translation.replace(/^\s*tr\s*=/, "");
    const words = [...value.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(match => match[1] ?? "");
    for (const parts of templates(value)) {
      if (["t", "t+", "trad"].includes(parts[0]?.trim() ?? "") && parts[1]?.trim() === "tr") words.push(parts[2] ?? "");
    }
    for (const word of new Set(words.filter(Boolean))) {
      if (!/^[\p{Script=Latin}\p{M} '\u2019-]{1,80}$/u.test(word)) continue;
      const sense = plain(block[1] ?? "");
      result.push({ ...source, turkish: word, russian: sense ? `${title} (${sense})` : title, partOfSpeech: "слово", exampleTurkish: "", exampleRussian: "" });
    }
  }
  return result.slice(0, 20);
}

export async function searchOnlineDictionary(query: string, fetcher: typeof fetch = fetch): Promise<OnlineWord[]> {
  const clean = query.trim().normalize("NFC");
  if (clean.length < 2 || clean.length > 100) throw new Error("Введите от 2 до 100 символов.");
  const url = new URL("https://ru.wiktionary.org/w/api.php");
  url.search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", prop: "revisions", rvprop: "content", rvslots: "main", redirects: "1", titles: clean }).toString();
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "TurkishFlashcards/0.1 (personal dictionary lookup)" } });
  if (!response.ok) throw new Error("Интернет-словарь временно недоступен. Повторите поиск позже.");
  const body = await response.json() as { error?: unknown; query?: { pages?: Page[] } };
  if (body.error || !body.query?.pages) throw new Error("Интернет-словарь не смог обработать запрос.");
  const now = Date.now();
  for (const [id, item] of pending) if (item.expires < now) pending.delete(id);
  const candidates = body.query.pages.flatMap(page => page.missing ? [] : parseDictionaryPage(page.title, page.revisions?.[0]?.slots.main.content ?? ""));
  return candidates.map(candidate => {
    const word = { ...candidate, id: randomUUID() };
    if (pending.size >= 500) pending.delete(pending.keys().next().value!);
    pending.set(word.id, { word, expires: now + 30 * 60 * 1000 });
    return word;
  });
}

export async function searchAllOnlineSources(query: string, fetcher: typeof fetch = fetch) {
  const clean = query.trim().normalize("NFC");
  if (clean.length < 2 || clean.length > 100) throw new Error("Введите от 2 до 100 символов.");
  const [dictionary, tatoeba] = await Promise.allSettled([
    searchOnlineDictionary(clean, fetcher), searchTatoeba(clean, fetcher),
  ]);
  if (dictionary.status === "rejected" && tatoeba.status === "rejected") {
    throw new Error("Источники поиска временно недоступны.");
  }
  const warnings: string[] = [];
  if (dictionary.status === "rejected") warnings.push("Викисловарь недоступен. Показаны результаты Tatoeba.");
  if (tatoeba.status === "rejected") warnings.push("Tatoeba недоступен. Показаны результаты Викисловаря.");
  const examples = tatoeba.status === "fulfilled" ? tatoeba.value : [];
  const words = dictionary.status === "fulfilled" ? dictionary.value : [];
  for (const word of words) {
    word.examples = examples.filter(example => exampleContainsPhrase(example.turkish, word.turkish));
  }
  for (const example of examples) {
    const word: OnlineWord = {
      id: randomUUID(), turkish: example.turkish, russian: example.russian, partOfSpeech: "фраза",
      exampleTurkish: example.turkish, exampleRussian: example.russian,
      sourceName: "Tatoeba", sourceUrl: example.sourceUrl, sourceLicense: example.license,
      examples: [example],
    };
    if (pending.size >= 500) pending.delete(pending.keys().next().value!);
    pending.set(word.id, { word, expires: Date.now() + 30 * 60 * 1000 });
    words.push(word);
  }
  return { candidates: words, warnings };
}

export function confirmOnlineWord(database: DatabaseSync, id: string, exampleId?: string) {
  const item = pending.get(id);
  if (!item || item.expires < Date.now()) return null;
  const { word } = item;
  const example = exampleId ? word.examples?.find(example => example.id === exampleId) : undefined;
  if (exampleId && !example) return null;
  const selected = example ?? (word.sourceName === "Tatoeba" ? word.examples?.[0] : undefined);
  return createUserEntry(database, { ...word, category: word.sourceName,
    exampleTurkish: selected?.turkish ?? word.exampleTurkish,
    exampleRussian: selected?.russian ?? word.exampleRussian,
  }, {
    name: word.sourceName, url: word.sourceUrl, license: word.sourceLicense ?? "CC BY-SA 4.0 (Wiktionary)",
    example: selected ? { name: `Tatoeba${selected.authors ? ` (${selected.authors})` : ""}`,
      url: selected.sourceUrl, translationUrl: selected.translationSourceUrl, license: selected.license } : undefined,
  });
}
