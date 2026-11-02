// A correction applies to a specific word/sense/example combination, never every homonym.
export function correctKnownSense<T extends { turkish: string; russian: string; partOfSpeech: string; exampleTurkish: string }>(record: T): T {
  if (record.turkish.toLocaleLowerCase("tr-TR") === "alma" &&
      record.russian.trim().toLocaleLowerCase("ru-RU") === "яблоко" &&
      record.exampleTurkish.trim() === "Karar alma zamanı.") {
    return { ...record, russian: "взятие; получение; покупка; принятие (от almak)", partOfSpeech: "отглагольное существительное" };
  }
  return record;
}
