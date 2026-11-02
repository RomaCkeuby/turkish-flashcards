import type { DatabaseSync } from "node:sqlite";
import { getEntries, getEntryDetail, type DictionaryEntry } from "./database.ts";
import { isReliableExamplePair } from "./dataQuality.ts";
import { searchOnlineDictionary } from "./onlineDictionary.ts";
import { normalizeTurkishKey } from "./updatePackage.ts";

export function meaningKeys(value: string) {
  return [...new Set(value.normalize("NFC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, "").split(/[;,\n]/)
    .map(item => item.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim()).filter(Boolean))];
}

type Word = Pick<DictionaryEntry, "turkish" | "russian" | "exampleTurkish" | "exampleRussian">;
export function checkLocalEntry(database: DatabaseSync, word: Word, excludeId?: number) {
  const meanings = new Set(meaningKeys(word.russian));
  const matches = getEntries(database, "", Number.MAX_SAFE_INTEGER, 0).entries
    .filter(entry => entry.id !== excludeId)
    .map(entry => ({ id: entry.id, turkish: entry.turkish, russian: entry.russian, partOfSpeech: entry.partOfSpeech,
      sameWord: normalizeTurkishKey(entry.turkish) === normalizeTurkishKey(word.turkish),
      sharedMeanings: meaningKeys(entry.russian).filter(meaning => meanings.has(meaning)) }))
    .filter(entry => entry.sameWord || entry.sharedMeanings.length > 0);
  const warnings: string[] = [];
  if (matches.some(entry => entry.sameWord)) warnings.push("Такое турецкое слово уже есть в коллекции. Проверьте, совпадает ли значение.");
  if (matches.some(entry => entry.sharedMeanings.length)) warnings.push("Есть совпадающие русские значения. Это могут быть синонимы, разные значения или ошибка; автоматическое слияние не выполняется.");
  if (word.exampleTurkish && word.exampleRussian && !isReliableExamplePair(word))
    warnings.push("Пример требует проверки: слово или русский перевод не найден в примере простым сопоставлением. Склонения и спряжения могут давать ложное предупреждение.");
  if (normalizeTurkishKey(word.turkish) === "alma") warnings.push("Alma может быть отглагольным именем от almak или формой «не бери». Значение «яблоко» также встречается в словарях; в базовом современном словаре используйте elma. Для «Karar alma zamanı» нужно значение принятия решения.");
  return { matches, warnings };
}

export function auditDictionary(database: DatabaseSync) {
  const entries = getEntries(database, "", Number.MAX_SAFE_INTEGER, 0).entries;
  const index = new Map<string, DictionaryEntry[]>();
  const words = new Map<string, DictionaryEntry[]>();
  for (const entry of entries) {
    for (const key of meaningKeys(entry.russian)) index.set(key, [...(index.get(key) ?? []), entry]);
    const key = normalizeTurkishKey(entry.turkish);
    words.set(key, [...(words.get(key) ?? []), entry]);
  }
  return { checkedAt: new Date().toISOString(), total: entries.length,
    groups: [...index].filter(([, items]) => items.length > 1).map(([meaning, items]) => ({ reason: "meaning", key: meaning, entries: items })),
    duplicateWords: [...words].filter(([, items]) => items.length > 1).map(([key, items]) => ({ reason: "word", key, entries: items })),
    exampleWarnings: entries.filter(entry => entry.exampleTurkish && entry.exampleRussian && !isReliableExamplePair(entry)),
  };
}

export async function verifyEntry(database: DatabaseSync, entryId: number, fetcher: typeof fetch = fetch) {
  const detail = getEntryDetail(database, entryId);
  if (!detail || detail.removal) return null;
  const word = detail.effective;
  const meanings = meaningKeys(word.russian).slice(0, 3);
  const queries = [...new Set([word.turkish, ...meanings].filter(value => value.length >= 2 && value.length <= 100))];
  const tdkRequest = async () => {
    const url = new URL("https://sozluk.gov.tr/gts");
    url.searchParams.set("ara", word.turkish.trim());
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("TDK недоступен");
    const data: unknown = await response.json();
    if (typeof data === "object" && data !== null && "error" in data) return [];
    if (!Array.isArray(data)) throw new Error("Некорректный ответ TDK");
    return (data as { madde?: string; anlamlarListe?: { anlam?: string }[] }[])
      .filter(item => typeof item.madde === "string" && normalizeTurkishKey(item.madde) === normalizeTurkishKey(word.turkish))
      .flatMap(item => item.anlamlarListe ?? []).map(item => item.anlam).filter((text): text is string => typeof text === "string");
  };
  const [results, tdk] = await Promise.all([
    Promise.allSettled(queries.map(query => searchOnlineDictionary(query, fetcher))),
    Promise.allSettled([tdkRequest()]).then(items => items[0]!),
  ]);
  const online = queries.map((query, index) => {
    const result = results[index]!;
    const sourceUrl = `https://ru.wiktionary.org/wiki/${encodeURIComponent(query)}`;
    if (result.status === "rejected") return { query, sourceUrl, status: "unavailable", candidates: [] };
    const candidates = result.value.map(({ turkish, russian, partOfSpeech, sourceUrl }) => ({ turkish, russian, partOfSpeech, sourceUrl }));
    const matched = candidates.some(candidate => normalizeTurkishKey(candidate.turkish) === normalizeTurkishKey(word.turkish) &&
      meaningKeys(candidate.russian).some(key => meaningKeys(word.russian).includes(key)));
    return { query, sourceUrl, status: matched ? "matched" : candidates.length ? "differences" : "not_found", candidates };
  });
  const definitions = tdk.status === "fulfilled" ? tdk.value : [];
  return { entryId, checkedAt: new Date().toISOString(), local: checkLocalEntry(database, word, entryId), online,
    turkishDictionary: { sourceUrl: `https://sozluk.gov.tr/?ara=${encodeURIComponent(word.turkish)}`,
      status: tdk.status === "rejected" ? "unavailable" : definitions.length ? "found" : "not_found", definitions },
  };
}
