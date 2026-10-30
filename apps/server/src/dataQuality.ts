import { DatabaseSync } from "node:sqlite";

import { normalizeTurkishKey } from "./updatePackage.ts";

export function textContainsWholeTurkishWord(text: string, word: string) {
  const normalizedWord = normalizeTurkishKey(word);
  const tokens = text.toLocaleLowerCase("tr-TR").match(/\p{L}+/gu) ?? [];

  return tokens.some((token) => normalizeTurkishKey(token) === normalizedWord);
}

export function russianMeaningAppearsInExample(russian: string, exampleRussian: string) {
  const example = exampleRussian.toLocaleLowerCase("ru-RU");
  const meanings = russian
    .split(/[;,]/)
    .map((value) => value.replace(/\([^)]*\)/g, "").trim().toLocaleLowerCase("ru-RU"))
    .filter((value) => value.length >= 3);

  if (meanings.length === 0) {
    return false;
  }

  return meanings.some((meaning) => {
    const words = meaning.match(/\p{L}+/gu) ?? [];
    const meaningfulWords = words.filter((word) => word.length >= 4);
    if (meaningfulWords.length === 0) {
      return example.includes(meaning);
    }

    return meaningfulWords.some((word) => example.includes(word));
  });
}

export function isReliableExamplePair(record: {
  exampleRussian: string;
  exampleTurkish: string;
  russian: string;
  turkish: string;
}) {
  return (
    textContainsWholeTurkishWord(record.exampleTurkish, record.turkish) &&
    russianMeaningAppearsInExample(record.russian, record.exampleRussian)
  );
}

export function repairKnownDataQualityIssues(database: DatabaseSync) {
  const now = new Date().toISOString();
  const badAkar = database.prepare(`
    SELECT id
    FROM entries
    WHERE turkish = 'akar'
      AND russian = 'клещ'
      AND example_turkish LIKE '%burnum akar%'
  `).get() as { id: number } | undefined;

  if (!badAkar) {
    return;
  }

  database.exec("BEGIN IMMEDIATE;");
  try {
    database.prepare(`
      UPDATE entries
      SET
        russian = 'течёт; протекает; течёт из носа',
        part_of_speech = 'глагольная форма',
        updated_at = ?
      WHERE id = ?
    `).run(now, badAkar.id);

    database.prepare(`
      INSERT INTO entry_translation_items (
        entry_id, layer, text, is_primary, position, source_name, source_url, source_license,
        created_at, updated_at
      )
      VALUES (?, 'base', 'течёт; протекает; течёт из носа', 1, 0, 'Curated quality fix', '', 'Manual correction of mismatched Kaikki/Tatoeba sense', ?, ?)
      ON CONFLICT(entry_id, layer, position) DO UPDATE SET
        text = excluded.text,
        source_name = excluded.source_name,
        source_license = excluded.source_license,
        updated_at = excluded.updated_at
    `).run(badAkar.id, now, now);

    database.prepare(`
      INSERT INTO entry_change_log (
        entry_id, field, old_value_json, new_value_json, change_source, changed_at
      )
      VALUES
        (?, 'russian', '"клещ"', '"течёт; протекает; течёт из носа"', 'update', ?),
        (?, 'partOfSpeech', '"существительное"', '"глагольная форма"', 'update', ?)
    `).run(badAkar.id, now, badAkar.id, now);

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
