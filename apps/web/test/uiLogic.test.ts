import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEntryPatch, emptyDraft, mergeEntryDraft, historyValue, readEntryDraft, saveEntryDraft } from "../src/entryEditor.ts";
import { readStudySession, saveStudySession, studyKey, studyShortcut } from "../src/studySession.ts";

test("saving only a tag does not freeze translations or examples", () => {
  const baseline = { ...emptyDraft, turkish: "merhaba", russian: "привет", tags: "A1, любимое" };
  assert.deepEqual(buildEntryPatch({ ...baseline, tags: "новый, новый" }, baseline), { tags: ["новый"] });
  assert.deepEqual(buildEntryPatch({ ...baseline, tags: "любимое, A1, A1" }, baseline), {});
  assert.deepEqual(buildEntryPatch({ ...baseline, russian: "  здравствуй  " }, baseline), { russian: "здравствуй" });
});

test("draft rebasing keeps user input and adopts unedited server fields", () => {
  const baseline = { ...emptyDraft, turkish: "merhaba", russian: "привет", category: "Старая" };
  const next = { ...baseline, russian: "новый перевод", category: "Новая" };
  const draft = { ...baseline, russian: "мой черновик" };
  assert.deepEqual(mergeEntryDraft(draft, baseline, next), { ...next, russian: "мой черновик" });
});

test("shortcuts ignore input, modifiers, held keys and support Russian layout undo", () => {
  const event = { key: " ", code: "Space", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false };
  assert.equal(studyShortcut(event, false), "reveal");
  assert.equal(studyShortcut(event, true), null);
  assert.equal(studyShortcut({ ...event, repeat: true }, false), null);
  assert.equal(studyShortcut({ ...event, key: "1", code: "Digit1" }, false), "incorrect");
  assert.equal(studyShortcut({ ...event, key: "2", code: "Numpad2" }, false), "correct");
  assert.equal(studyShortcut({ ...event, key: "я", code: "KeyZ", ctrlKey: true }, false), "undo");
  assert.equal(studyShortcut({ ...event, key: "z", code: "KeyZ", metaKey: true }, false), "undo");
  assert.equal(studyShortcut({ ...event, code: "KeyZ", ctrlKey: true, shiftKey: true }, false), null);
});

test("session and draft storage retain context and tolerate corrupted data", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });
  try {
    const session = { key: studyKey(new URLSearchParams("mode=review&tag=A1")), cardId: 42,
      revealed: true, undo: { token: "token", cardId: 41, query: "mode=review&tag=A1" } };
    saveStudySession(session);
    assert.deepEqual(readStudySession(), session);
    assert.equal(studyKey(new URLSearchParams("tag=A1&mode=review")), session.key);
    const baseline = { ...emptyDraft, turkish: "merhaba", russian: "привет" };
    saveEntryDraft(1, { ...baseline, russian: "черновик" }, baseline);
    assert.equal(readEntryDraft(1, baseline).russian, "черновик");
    saveEntryDraft(1, baseline, baseline);
    assert.deepEqual(readEntryDraft(1, baseline), baseline);
    for (const key of values.keys()) values.set(key, "{broken");
    assert.equal(readStudySession(), null);
    assert.deepEqual(readEntryDraft(1, baseline), baseline);
  } finally { Reflect.deleteProperty(globalThis, "sessionStorage"); }
});

test("history uses readable values instead of raw JSON and status codes", () => {
  assert.equal(historyValue('"ACTIVE"'), "Активна");
  assert.equal(historyValue('["A1","работа"]'), "A1, работа");
  assert.equal(historyValue('null'), "не задано");
});
