export type StudyUndo = { token: string; cardId: number; query: string };
export type StudySession = { key: string; cardId: number | null; revealed: boolean; undo: StudyUndo | null };
const storageKey = "turkish-flashcards.study.v1";

export function readStudySession(): StudySession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as StudySession | null;
    if (!value || typeof value.key !== "string" || typeof value.revealed !== "boolean" ||
      (value.cardId !== null && (!Number.isSafeInteger(value.cardId) || value.cardId <= 0))) return null;
    if (value.undo && (typeof value.undo.token !== "string" || !Number.isSafeInteger(value.undo.cardId) ||
      value.undo.cardId <= 0 || typeof value.undo.query !== "string")) value.undo = null;
    return value;
  } catch { return null; }
}

export function saveStudySession(value: StudySession) {
  try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ }
}

export function studyKey(params: URLSearchParams) {
  return JSON.stringify([params.get("direction") === "ru-tr" ? "ru-tr" : "tr-ru",
    params.get("mode") === "new" ? "new" : params.get("mode") === "review" ? "review" : "all",
    params.get("category") ?? "", params.get("partOfSpeech") ?? "", params.get("tag") ?? ""]);
}

export function studyShortcut(event: {
  key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean;
}, editing: boolean) {
  if (editing || event.repeat || event.altKey || event.shiftKey) return null;
  if (event.ctrlKey || event.metaKey) return event.code === "KeyZ" ? "undo" : null;
  if (event.code === "Space" || event.key === " ") return "reveal";
  if (event.code === "Digit1" || event.code === "Numpad1") return "incorrect";
  if (event.code === "Digit2" || event.code === "Numpad2") return "correct";
  return null;
}
