import type { DictionaryEntry, EntryPatch } from "./api";

export const editableFields = ["turkish", "russian", "partOfSpeech", "category", "exampleTurkish", "exampleRussian", "tags"] as const;
export type EntryDraft = Record<typeof editableFields[number], string>;
export const emptyDraft: EntryDraft = { turkish: "", russian: "", partOfSpeech: "", category: "", exampleTurkish: "", exampleRussian: "", tags: "" };

export function entryDraft(entry: DictionaryEntry): EntryDraft {
  return { turkish: entry.turkish, russian: entry.russian, partOfSpeech: entry.partOfSpeech,
    category: entry.category, exampleTurkish: entry.exampleTurkish, exampleRussian: entry.exampleRussian,
    tags: entry.tags.join(", ") };
}

export function buildEntryPatch(draft: EntryDraft, baseline: EntryDraft): EntryPatch {
  const patch: EntryPatch = {};
  for (const field of editableFields) {
    if (field === "tags") {
      const parse = (value: string) => [...new Set(value.split(",").map(tag => tag.trim()).filter(Boolean))].sort();
      const tags = parse(draft.tags);
      if (JSON.stringify(tags) !== JSON.stringify(parse(baseline.tags))) patch.tags = tags;
    } else if (draft[field].trim() !== baseline[field].trim()) patch[field] = draft[field].trim();
  }
  return patch;
}

export function mergeEntryDraft(draft: EntryDraft, baseline: EntryDraft, next: EntryDraft): EntryDraft {
  return Object.fromEntries(editableFields.map(field => [field,
    draft[field] === baseline[field] ? next[field] : draft[field],
  ])) as EntryDraft;
}

export function readEntryDraft(id: number, next: EntryDraft): EntryDraft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`turkish-flashcards.draft.${id}`) ?? "null") as {
      draft: EntryDraft; baseline: EntryDraft;
    } | null;
    if (!saved || !editableFields.every(field => typeof saved.draft?.[field] === "string" && typeof saved.baseline?.[field] === "string")) return next;
    return mergeEntryDraft(saved.draft, saved.baseline, next);
  } catch { return next; }
}

export function saveEntryDraft(id: number, draft: EntryDraft, baseline: EntryDraft) {
  try {
    const key = `turkish-flashcards.draft.${id}`;
    if (Object.keys(buildEntryPatch(draft, baseline)).length) sessionStorage.setItem(key, JSON.stringify({ draft, baseline }));
    else sessionStorage.removeItem(key);
  } catch { /* Editing must work even when storage is disabled. */ }
}

export const fieldLabels: Record<string, string> = {
  turkish: "Турецкое слово", russian: "Русский перевод", partOfSpeech: "Часть речи", category: "Категория",
  exampleTurkish: "Пример на турецком", exampleRussian: "Перевод примера", tags: "Теги", status: "Статус", created: "Создание карточки",
};
export const statusLabels = { ACTIVE: "Активна", DISABLED: "Отключена", ARCHIVED: "В архиве" } as const;

export function historyValue(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || parsed === "") return "не задано";
    if (Array.isArray(parsed)) return parsed.length ? parsed.join(", ") : "нет";
    if (typeof parsed === "string") return statusLabels[parsed as keyof typeof statusLabels] ?? parsed;
    if (typeof parsed === "object") return Object.entries(parsed)
      .map(([key, item]) => `${fieldLabels[key] ?? key}: ${String(item)}`).join("; ");
    return String(parsed);
  } catch { return value; }
}
