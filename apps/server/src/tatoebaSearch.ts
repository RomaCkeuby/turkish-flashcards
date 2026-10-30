export type UsageExample = {
  id: string;
  turkish: string;
  russian: string;
  sourceUrl: string;
  translationSourceUrl: string;
  license: string;
  authors: string;
};

type Sentence = {
  id: number; text: string; lang: string; license: string; owner?: string;
  is_unapproved?: boolean; is_direct?: boolean; translations?: Sentence[];
};

export async function searchTatoeba(query: string, fetcher: typeof fetch = fetch): Promise<UsageExample[]> {
  const language = /[а-яё]/iu.test(query) ? "rus" : "tur";
  const target = language === "rus" ? "tur" : "rus";
  const url = new URL("https://api.tatoeba.org/v1/sentences");
  url.search = new URLSearchParams({ lang: language, q: query, sort: "words", limit: "10",
    is_unapproved: "no", "trans:lang": target, "trans:is_direct": "yes", "trans:is_unapproved": "no" }).toString();
  const response = await fetcher(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("Tatoeba временно недоступен.");
  const body = await response.json() as { data?: Sentence[] };
  if (!Array.isArray(body.data)) throw new Error("Некорректный ответ Tatoeba.");
  const pairs: UsageExample[] = [];
  for (const sentence of body.data) {
    if (sentence.lang !== language || sentence.is_unapproved || !sentence.text || !Number.isInteger(sentence.id)) continue;
    for (const translation of sentence.translations ?? []) {
      if (translation.lang !== target || translation.is_direct !== true || translation.is_unapproved || !translation.text || !Number.isInteger(translation.id)) continue;
      const turkish = language === "tur" ? sentence : translation;
      const russian = language === "rus" ? sentence : translation;
      if (turkish.text.length > 300 || russian.text.length > 400 || !turkish.license || !russian.license) continue;
      pairs.push({
        id: `${turkish.id}:${russian.id}`, turkish: turkish.text, russian: russian.text,
        sourceUrl: `https://tatoeba.org/en/sentences/show/${turkish.id}`,
        translationSourceUrl: `https://tatoeba.org/en/sentences/show/${russian.id}`,
        license: [...new Set([turkish.license, russian.license])].join("; "),
        authors: [...new Set([turkish.owner, russian.owner].filter(Boolean))].join(", "),
      });
    }
  }
  return [...new Map(pairs.map(pair => [pair.id, pair])).values()].slice(0, 12);
}

export function exampleContainsPhrase(example: string, word: string) {
  const normalize = (value: string) => value.normalize("NFC").toLocaleLowerCase("tr-TR").match(/[\p{L}\p{M}]+/gu)?.join(" ") ?? "";
  const phrase = normalize(word);
  return !!phrase && ` ${normalize(example)} `.includes(` ${phrase} `);
}
