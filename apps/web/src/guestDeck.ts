import type { PublicCardEntry } from "./publicDeckTypes.ts";

export type GuestDirection = "tr-ru" | "ru-tr";
export type GuestFilters = {
  category?: string;
  partOfSpeech?: string;
  tag?: string;
  search?: string;
};
export type GuestCard = { entry: PublicCardEntry; direction: GuestDirection };

function searchText(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("tr-TR").replaceAll("ё", "е");
}

/** Returns matching source entries without modifying the published collection. */
export function filterGuestEntries(entries: readonly PublicCardEntry[], filters: GuestFilters = {}) {
  const search = searchText(filters.search?.trim() ?? "");
  return entries.filter(entry =>
    (!filters.category || entry.category === filters.category) &&
    (!filters.partOfSpeech || entry.partOfSpeech === filters.partOfSpeech) &&
    (!filters.tag || entry.tags.includes(filters.tag)) &&
    (!search || searchText(`${entry.turkish}\n${entry.russian}`).includes(search)));
}

export function getGuestFilterOptions(entries: readonly PublicCardEntry[]) {
  const sorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  return {
    categories: sorted(entries.map(entry => entry.category)),
    partsOfSpeech: sorted(entries.map(entry => entry.partOfSpeech)),
    tags: sorted(entries.flatMap(entry => entry.tags)),
  };
}

/** One shuffled pass. Keep this array and an index during a session; call again for a new pass. */
export function createGuestDeck(
  entries: readonly PublicCardEntry[],
  options: GuestFilters & { direction: GuestDirection },
  random: () => number = Math.random,
): GuestCard[] {
  if (options.direction !== "tr-ru" && options.direction !== "ru-tr") {
    throw new Error("Неизвестное направление карточек.");
  }
  const seen = new Set<string>();
  const deck = filterGuestEntries(entries, options).map(entry => {
    if (seen.has(entry.key)) throw new Error(`Повторяющийся ключ карточки: ${entry.key}`);
    seen.add(entry.key);
    return { entry, direction: options.direction };
  });
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error("Генератор случайных чисел должен возвращать значение от 0 включительно до 1 исключительно.");
    }
    const other = Math.floor(value * (index + 1));
    [deck[index], deck[other]] = [deck[other]!, deck[index]!];
  }
  return deck;
}
