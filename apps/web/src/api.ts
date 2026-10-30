export type CardDirection = "ru-tr" | "tr-ru";
export type EntryStatus = "ACTIVE" | "ARCHIVED" | "DISABLED";
export type ReviewResult = "correct" | "incorrect";
export type StudyMode = "all" | "review" | "new";

export type DictionaryEntry = {
  category: string;
  createdAt: string;
  exampleRussian: string;
  exampleSource: string;
  exampleSourceLicense: string;
  exampleSourceUrl: string;
  exampleTurkish: string;
  exampleTranslationSourceUrl: string;
  id: number;
  partOfSpeech: string;
  russian: string;
  sourceLicense: string;
  sourceName: string;
  sourceUrl: string | null;
  status: EntryStatus;
  tags: string[];
  turkish: string;
  updatedAt: string;
};

export type StudyCard = DictionaryEntry & {
  direction: CardDirection;
  entryId: number;
};

export type QueueStats = {
  accuracyToday: number | null;
  correctToday: number;
  due: number;
  isDoneToday: boolean;
  newAvailable: number;
  newTotal: number;
  newUsedToday: number;
  reviewedToday: number;
};

export type Stats = {
  cards: number;
  entries: number;
  queue: QueueStats;
  reviewed: number;
  directions?: Record<CardDirection, QueueStats>;
};

export type UpdateRecord = Omit<DictionaryEntry, "id"> & {
  sourceLicense: string;
  sourceName: string;
  sourceUrl: string;
};

export type UpdatePreview = {
  added: number;
  changed: number;
  disabled: number;
  details: {
    added: UpdateRecord[];
    changed: {
      after: UpdateRecord;
      before: Omit<DictionaryEntry, "createdAt" | "sourceLicense" | "sourceName" | "sourceUrl" | "status" | "tags" | "updatedAt"> & {
        active: number;
      };
      fields: string[];
    }[];
    disabled: Pick<DictionaryEntry, "russian" | "turkish">[];
  };
  examples: {
    added: UpdateRecord[];
    changed: UpdateRecord[];
    disabled: Pick<DictionaryEntry, "russian" | "turkish">[];
  };
  manifest: {
    createdAt: string;
    recordCount: number;
    sha256: string;
    source: {
      license: string;
      name: string;
      url: string;
    };
    version: string;
  };
};

export type UpdateStatus = {
  autoCheckEnabled: boolean;
  canRollback: boolean;
  lastCheckAt: string | null;
  lastUpdate: {
    added: number;
    appliedAt: string;
    changed: number;
    disabled: number;
    manifestSha256: string;
    packageVersion: string;
  } | null;
  nextCheckAt: string | null;
  packageAvailable: boolean;
  preview: UpdatePreview | null;
};

export type DictionaryImportPreview = {
  manifest: UpdatePreview["manifest"];
  preview: UpdatePreview;
};

export type EntryDetail = {
  base: DictionaryEntry;
  cards: {
    direction: CardDirection;
    enabled: boolean;
    id: number;
  }[];
  effective: DictionaryEntry;
  examples: {
    id: number;
    isPrimary: boolean;
    layer: "base" | "override";
    russian: string;
    sourceLicense: string;
    sourceName: string;
    sourceUrl: string;
    turkish: string;
  }[];
  history: {
    changedAt: string;
    field: string;
    id: number;
    newValueJson: string;
    oldValueJson: string;
  }[];
  override: Partial<DictionaryEntry> | null;
  review: {
    dueAt: string | null;
    easeFactor: number | null;
    intervalDays: number | null;
    lastReviewedAt: string | null;
    repetitions: number;
  };
  translations: {
    id: number;
    isPrimary: boolean;
    layer: "base" | "override";
    sourceLicense: string;
    sourceName: string;
    sourceUrl: string;
    text: string;
  }[];
};

export type EntryRefreshSuggestion = {
  changes: {
    field: string;
    from: string;
    to: string;
  }[];
  patch: EntryPatch;
  sourceName: string;
  sourceUrl?: string;
};

export type EntryPatch = {
  category?: string;
  exampleRussian?: string;
  exampleTurkish?: string;
  partOfSpeech?: string;
  russian?: string;
  status?: EntryStatus;
  tags?: string[];
  turkish?: string;
};

export type EntryFilters = {
  category?: string;
  limit?: number;
  offset?: number;
  partOfSpeech?: string;
  status?: EntryStatus;
  tag?: string;
};

export type EntryFilterOptions = {
  categories: string[];
  partsOfSpeech: string[];
  tags: string[];
};

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, options);

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
      throw new Error(payload.error);
    }
    throw new Error(`API вернул ошибку ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

export function fetchStats(signal?: AbortSignal) {
  return request<Stats>("/stats", { signal });
}

export function fetchEntries(search: string, filters: EntryFilters = {}, signal?: AbortSignal) {
  const query = new URLSearchParams({
    limit: String(filters.limit ?? 50),
    offset: String(filters.offset ?? 0),
    search,
  });

  if (filters.status) {
    query.set("status", filters.status);
  }
  if (filters.category) {
    query.set("category", filters.category);
  }
  if (filters.partOfSpeech) {
    query.set("partOfSpeech", filters.partOfSpeech);
  }
  if (filters.tag) {
    query.set("tag", filters.tag);
  }

  return request<{ entries: DictionaryEntry[]; total: number }>(`/entries?${query}`, { signal });
}

export function fetchEntryFilters(signal?: AbortSignal) {
  return request<EntryFilterOptions>("/entries/filters", { signal });
}

export type OnlineWord = {
  id: string; turkish: string; russian: string; partOfSpeech: string;
  exampleTurkish: string; exampleRussian: string; sourceName: string; sourceUrl: string;
  examples?: {
    id: string; turkish: string; russian: string; sourceUrl: string;
    translationSourceUrl: string; license: string; authors: string;
  }[];
};

export function searchOnlineWords(query: string, signal?: AbortSignal) {
  return request<{ candidates: OnlineWord[]; warnings?: string[] }>(`/dictionary/online?${new URLSearchParams({ query })}`, { signal });
}

export function confirmOnlineWord(id: string, exampleId?: string) {
  return request<EntryDetail>("/dictionary/online/confirm", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, exampleId }),
  });
}

export function createEntry(patch: EntryPatch & { russian: string; turkish: string }) {
  return request<EntryDetail>("/entries", {
    body: JSON.stringify(patch),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export function fetchEntryDetail(entryId: number, signal?: AbortSignal) {
  return request<EntryDetail>(`/entries/${entryId}`, { signal });
}

export function updateEntry(entryId: number, patch: EntryPatch) {
  return request<EntryDetail>(`/entries/${entryId}`, {
    body: JSON.stringify(patch),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

export function setEntryStatus(entryId: number, status: EntryStatus) {
  return request<EntryDetail>(`/entries/${entryId}/status`, {
    body: JSON.stringify({ status }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export function fetchEntryRefreshSuggestion(entryId: number) {
  return request<EntryRefreshSuggestion>(`/entries/${entryId}/refresh-suggestion`);
}

export function applyEntryRefreshSuggestion(entryId: number) {
  return request<{ detail: EntryDetail; suggestion: EntryRefreshSuggestion }>(
    `/entries/${entryId}/refresh-apply`,
    { method: "POST" },
  );
}

export function fetchNextCard(direction: CardDirection, filters: EntryFilters = {}, signal?: AbortSignal,
  options: { mode?: StudyMode; cardId?: number } = {}) {
  const query = new URLSearchParams({ direction });
  if (options.mode) query.set("mode", options.mode);
  if (options.cardId) query.set("cardId", String(options.cardId));
  if (filters.category) {
    query.set("category", filters.category);
  }
  if (filters.partOfSpeech) {
    query.set("partOfSpeech", filters.partOfSpeech);
  }
  if (filters.tag) {
    query.set("tag", filters.tag);
  }

  return request<{ card: StudyCard | null; queue: QueueStats }>(`/cards/next?${query}`, { signal });
}

export function submitReview(cardId: number, result: ReviewResult) {
  return request<{
    cardId: number;
    dueAt: string;
    intervalDays: number;
    result: ReviewResult;
    undoToken: string;
  }>("/reviews", {
    body: JSON.stringify({ cardId, result }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export function undoLastReview(token: string) {
  return request<{ cardId: number; restored: boolean }>("/reviews/undo", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
  });
}

export function fetchUpdateStatus(signal?: AbortSignal) {
  return request<UpdateStatus>("/updates/status", { signal });
}

export function applyUpdatePackage() {
  return request<UpdatePreview>("/updates/apply", { method: "POST" });
}

export function rollbackUpdatePackage() {
  return request<{ restored: boolean }>("/updates/rollback", { method: "POST" });
}

export function checkUpdatePackage() {
  return request<UpdateStatus>("/updates/check", { method: "POST" });
}

export function prepareDictionaryImport(options: { limit: number; query?: string }) {
  return request<DictionaryImportPreview>("/dictionary/import/prepare", {
    body: JSON.stringify(options),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export function applyDictionaryImport() {
  return request<UpdatePreview>("/dictionary/import/apply", { method: "POST" });
}
