import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeDatabase,
  createUserEntry,
  getEntries,
  getEntryFilterOptions,
  getEntryDetail,
  getNextCard,
  getQueueStats,
  getStats,
  openDatabase,
  patchEntry,
  recordReview,
} from "./database.ts";
import {
  applyUpdate,
  getDefaultPackageDirectory,
  getUpdateStatus,
  previewUpdate,
  rollbackLastUpdate,
} from "./updatePackage.ts";
import {
  applyDictionaryImportPackage,
  prepareDictionaryImportPackage,
} from "./dictionaryImport.ts";
import {
  applyEntryRefresh,
  suggestEntryRefresh,
} from "./cardRefresh.ts";

const importPackageDirectory = mkdtempSync(join(tmpdir(), "turkish-flashcards-check-"));
try {
  runChecks(importPackageDirectory);
} finally {
  for (const file of readdirSync(importPackageDirectory)) unlinkSync(join(importPackageDirectory, file));
  rmdirSync(importPackageDirectory);
}

function runChecks(importPackageDirectory: string) {
  const database = openDatabase(":memory:");
  const stats = getStats(database);
  const sample = getEntries(database, "merhaba", 10, 0);
  const belkiSample = getEntries(database, "belki", 10, 0);
  const akarSample = getEntries(database, "akar", 10, 0);
  const russianUppercaseSearch = getEntries(database, "ПРИВЕТ", 10, 0);
  const turkishUppercaseSearch = getEntries(database, "TÜRKÇE", 10, 0);

  if (stats.entries < 250) {
    throw new Error(`Ожидалось не меньше 250 слов, найдено ${stats.entries}.`);
  }

  if (stats.cards < stats.entries * 2) {
    throw new Error(`Ожидалось минимум по 2 карточки на слово, найдено ${stats.cards}.`);
  }

  if (sample.total !== 1 || sample.entries[0]?.russian !== "привет") {
    throw new Error("Контрольная запись merhaba не найдена.");
  }

  if (
    belkiSample.total !== 1 ||
    belkiSample.entries[0]?.exampleSource !== "Tatoeba" ||
    belkiSample.entries[0]?.exampleSourceLicense !== "CC BY 2.0 FR" ||
    !belkiSample.entries[0]?.exampleTurkish.toLocaleLowerCase("tr-TR").includes("belki") ||
    !belkiSample.entries[0]?.exampleSourceUrl.startsWith("https://tatoeba.org/")
  ) {
    throw new Error("Пример для belki должен приходить из Tatoeba с атрибуцией.");
  }

  if (
    akarSample.entries.some((entry) => entry.russian === "клещ") ||
    akarSample.entries.some((entry) => entry.exampleRussian.includes("насморк") && !entry.russian.includes("теч"))
  ) {
    throw new Error("Карточка akar не должна связывать перевод «клещ» с примером про насморк.");
  }

  const sourcedExamples = getEntries(database, "", 250, 0).entries.filter(
    (entry) => entry.exampleSource === "Tatoeba",
  );
  const firstDictionaryPage = getEntries(database, "", 50, 0);
  const secondDictionaryPage = getEntries(database, "", 50, 50);
  const verbEntries = getEntries(database, "", 50, 0, { partOfSpeech: "глагол" });
  const filterOptions = getEntryFilterOptions(database);

  if (sourcedExamples.length < 200) {
    throw new Error("Большая часть начальной коллекции должна иметь источниковые примеры.");
  }

  if (
    firstDictionaryPage.total !== stats.entries ||
    firstDictionaryPage.entries.length !== 50 ||
    secondDictionaryPage.entries.length !== 50 ||
    firstDictionaryPage.entries[0]?.id === secondDictionaryPage.entries[0]?.id
  ) {
    throw new Error("Пагинация словаря работает неверно.");
  }

  if (verbEntries.total === 0 || verbEntries.entries.some((entry) => entry.partOfSpeech !== "глагол")) {
    throw new Error("Фильтр словаря по части речи работает неверно.");
  }

  if (
    filterOptions.categories.includes("Глаголы") ||
    !filterOptions.tags.includes("A1") ||
    !filterOptions.tags.includes("A2")
  ) {
    throw new Error("Списки фильтров должны исключать дубли категорий и содержать уровни.");
  }

  if (russianUppercaseSearch.total !== 1 || turkishUppercaseSearch.total !== 1) {
    throw new Error("Регистронезависимый поиск работает неверно.");
  }

  const reviewDatabase = openDatabase(":memory:");
  const initialTime = new Date("2026-01-01T10:00:00.000Z");
  const initialCard = getNextCard(reviewDatabase, "tr-ru", initialTime) as {
    entryId?: number;
    id: number;
  };
  const incorrect = recordReview(reviewDatabase, initialCard.id, "incorrect", initialTime);

  if (!initialCard.entryId) {
    throw new Error("Учебная карточка должна содержать entryId для перехода к редактированию.");
  }

  if (
    !incorrect ||
    incorrect.dueAt !== "2026-01-01T10:05:00.000Z" ||
    incorrect.lapses !== 1 ||
    incorrect.repetitions !== 0
  ) {
    throw new Error("Неверный ответ должен назначать повтор через 5 минут.");
  }

  const dueCard = getNextCard(
    reviewDatabase,
    "tr-ru",
    new Date("2026-01-01T10:06:00.000Z"),
  ) as { id: number };

  if (dueCard.id !== initialCard.id) {
    throw new Error("Просроченная карточка должна иметь приоритет перед новой.");
  }

  const firstCorrect = recordReview(
    reviewDatabase,
    initialCard.id,
    "correct",
    new Date("2026-01-01T10:06:00.000Z"),
  );
  const secondCorrect = recordReview(
    reviewDatabase,
    initialCard.id,
    "correct",
    new Date("2026-01-02T10:06:00.000Z"),
  );

  if (firstCorrect?.intervalDays !== 1 || secondCorrect?.intervalDays !== 3) {
    throw new Error("Верные ответы должны увеличивать интервал с 1 до 3 дней.");
  }

  closeDatabase(reviewDatabase);

  const queueDatabase = openDatabase(":memory:");
  const queueTime = new Date("2026-01-03T10:00:00.000Z");
  const initialQueue = getQueueStats(queueDatabase, queueTime);

  if (initialQueue.newAvailable <= 20 || initialQueue.reviewedToday !== 0) {
    throw new Error("Новая учебная очередь должна начинаться без дневного лимита новых карточек.");
  }

  for (let index = 0; index < 20; index += 1) {
    const nextCard = getNextCard(queueDatabase, "tr-ru", queueTime) as { id: number } | null;
    if (!nextCard) {
      throw new Error("Новые карточки не должны заканчиваться из-за дневного лимита.");
    }
    recordReview(queueDatabase, nextCard.id, "correct", queueTime);
  }

  const exhaustedQueue = getQueueStats(queueDatabase, queueTime);
  const cardAfterLimit = getNextCard(queueDatabase, "tr-ru", queueTime);

  if (
    exhaustedQueue.newAvailable <= 0 ||
    exhaustedQueue.reviewedToday !== 20 ||
    exhaustedQueue.accuracyToday !== 100 ||
    cardAfterLimit === null
  ) {
    throw new Error("После 20 новых карточек очередь должна продолжаться без дневного лимита.");
  }

  closeDatabase(queueDatabase);

  const createDatabase = openDatabase(":memory:");
  const createdEntry = createUserEntry(createDatabase, {
    category: "Пользовательские",
    exampleRussian: "Это новое пользовательское слово.",
    exampleTurkish: "Bu yeni bir kelime.",
    partOfSpeech: "слово",
    russian: "новое слово",
    tags: ["личное"],
    turkish: "yeni-kelime-test",
  });

  if (
    !createdEntry ||
    createdEntry.effective.sourceName !== "Пользователь" ||
    createdEntry.cards.length !== 2 ||
    createdEntry.history.length === 0
  ) {
    throw new Error("Ручное добавление должно создавать пользовательскую запись, карточки и историю.");
  }

  const personalTagEntries = getEntries(createDatabase, "", 10, 0, { tag: "личное" });
  const personalTagQueue = getQueueStats(createDatabase, new Date("2026-01-05T10:00:00.000Z"), {
    tag: "личное",
  });
  const personalTagDirectionQueue = getQueueStats(
    createDatabase,
    new Date("2026-01-05T10:00:00.000Z"),
    { tag: "личное" },
    "tr-ru",
  );
  const personalTagCard = getNextCard(
    createDatabase,
    "tr-ru",
    new Date("2026-01-05T10:00:00.000Z"),
    { tag: "личное" },
  ) as { turkish: string } | null;

  if (
    personalTagEntries.total !== 1 ||
    personalTagEntries.entries[0]?.turkish !== "yeni-kelime-test"
  ) {
    throw new Error("Фильтр словаря по тегу работает неверно.");
  }

  if (
    personalTagQueue.newTotal !== 2 ||
    personalTagDirectionQueue.newTotal !== 1 ||
    personalTagCard?.turkish !== "yeni-kelime-test"
  ) {
    throw new Error("Фильтр учебной очереди по тегу работает неверно.");
  }

  closeDatabase(createDatabase);

  const updateDatabase = openDatabase(":memory:");
  const updatePackageDirectory = getDefaultPackageDirectory();
  const updatePreview = previewUpdate(updateDatabase, updatePackageDirectory);

  if (
    updatePreview.manifest.recordCount <= 250 ||
    updatePreview.added <= 0 ||
    updatePreview.manifest.sha256.length !== 64
  ) {
    throw new Error("Пакет обновления должен иметь manifest.json, cards.jsonl.gz и SHA-256.");
  }

  const progressCard = getNextCard(updateDatabase, "tr-ru", new Date("2026-01-04T10:00:00.000Z")) as {
    id: number;
  };
  const editableEntry = getEntries(updateDatabase, "belki", 1, 0).entries[0];

  if (!editableEntry) {
    throw new Error("Тестовая карточка belki должна существовать.");
  }

  const edited = patchEntry(updateDatabase, editableEntry.id, {
    category: "Пользовательская категория",
    exampleRussian: "Может быть, он придёт завтра.",
    exampleTurkish: "Belki yarın gelir.",
    partOfSpeech: "наречие",
    russian: "может быть; пожалуй",
    tags: ["A1", "любимое"],
  });

  if (
    !edited ||
    edited.effective.russian !== "может быть; пожалуй" ||
    !edited.effective.tags.includes("A1") ||
    !edited.effective.tags.includes("любимое") ||
    edited.history.length === 0
  ) {
    throw new Error("Override, теги и история изменений должны сохраняться.");
  }

  recordReview(updateDatabase, progressCard.id, "correct", new Date("2026-01-04T10:00:00.000Z"));
  const beforeApplyReviewed = getStats(updateDatabase).reviewed;
  const appliedPreview = applyUpdate(updateDatabase, updatePackageDirectory);
  const afterApplyReviewed = getStats(updateDatabase).reviewed;
  const updateStatus = getUpdateStatus(updateDatabase, updatePackageDirectory);

  if (beforeApplyReviewed !== afterApplyReviewed || !updateStatus.canRollback) {
    throw new Error("Обновление должно сохранять прогресс карточек и создавать снимок для отката.");
  }

  const afterApplyBelki = getEntryDetail(updateDatabase, editableEntry.id);

  if (afterApplyBelki?.effective.russian !== "может быть; пожалуй") {
    throw new Error("Обновление из интернета не должно перезаписывать пользовательский override.");
  }

  if (
    appliedPreview.added < 0 ||
    appliedPreview.changed < 0 ||
    appliedPreview.disabled < 0
  ) {
    throw new Error("Предпросмотр обновления должен возвращать добавленные, изменённые и отключённые записи.");
  }

  const rollback = rollbackLastUpdate(updateDatabase);

  if (!rollback?.restored || getStats(updateDatabase).reviewed !== beforeApplyReviewed) {
    throw new Error("Откат должен восстанавливать словарь без удаления прогресса.");
  }

  const afterRollbackBelki = getEntryDetail(updateDatabase, editableEntry.id);

  if (afterRollbackBelki?.effective.russian !== "может быть; пожалуй") {
    throw new Error("Откат base-обновления не должен удалять пользовательский override.");
  }

  closeDatabase(updateDatabase);

  const importDatabase = openDatabase(":memory:");
  const importBefore = getStats(importDatabase);
  const importPackage = prepareDictionaryImportPackage(importDatabase, { limit: 25, query: "" }, importPackageDirectory);

  if (
    importPackage.preview.added !== 25 ||
    importPackage.preview.disabled !== 0 ||
    importPackage.manifest.updateMode !== "append"
  ) {
    throw new Error("Импорт слов должен готовить append-only пакет без отключения существующей базы.");
  }

  const importApplied = applyDictionaryImportPackage(importDatabase, importPackageDirectory);
  const importAfter = getStats(importDatabase);

  if (
    importApplied.added !== 25 ||
    importApplied.disabled !== 0 ||
    importAfter.entries !== importBefore.entries + 25 ||
    importAfter.cards !== importBefore.cards + 50
  ) {
    throw new Error("Импорт слов должен добавлять новые записи и карточки без потери старой коллекции.");
  }

  closeDatabase(importDatabase);

  const refreshDatabase = openDatabase(":memory:");
  const refreshEntry = createUserEntry(refreshDatabase, {
    category: "Пользовательские",
    exampleRussian: "Старый пример.",
    exampleTurkish: "Eski örnek.",
    partOfSpeech: "слово",
    russian: "ошибка",
    turkish: "acele",
  });

  if (!refreshEntry) {
    throw new Error("Для проверки автообновления нужна временная карточка.");
  }

  const refreshSuggestion = suggestEntryRefresh(refreshDatabase, refreshEntry.effective.id);

  if (!refreshSuggestion || refreshSuggestion.changes.length === 0) {
    throw new Error("Автообновление карточки должно находить подтверждаемое предложение.");
  }

  const refreshBeforeStats = getStats(refreshDatabase);
  const refreshed = applyEntryRefresh(refreshDatabase, refreshEntry.effective.id);
  const refreshedDetail = getEntryDetail(refreshDatabase, refreshEntry.effective.id);

  if (
    !refreshed ||
    !refreshedDetail?.override ||
    getStats(refreshDatabase).reviewed !== refreshBeforeStats.reviewed
  ) {
    throw new Error("Применение автообновления должно сохранять предложение как override без потери прогресса.");
  }

  closeDatabase(refreshDatabase);

  console.log(JSON.stringify({ sample: sample.entries[0], stats }, null, 2));
  closeDatabase(database);
}
