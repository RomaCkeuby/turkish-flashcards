// Called synchronously before rendering a new identity, including cross-tab Auth events.
export function clearPersonalStorage(storage: Storage = sessionStorage) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key && (key.startsWith("turkish-flashcards.draft.") || key.startsWith("turkish-flashcards.study.") ||
        key.startsWith("turkish-flashcards.cloud.pending."))) storage.removeItem(key);
  }
}
