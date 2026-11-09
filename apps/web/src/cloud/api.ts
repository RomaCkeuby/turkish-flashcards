import { cloud } from "./client";
import { readStudySession, saveStudySession, studyKey } from "../studySession";
import { cloudIdentityRevision } from "./identity";

type Pending = { requestId: string; cardId: number; result: "correct" | "incorrect" };
export class CloudUnavailableError extends Error {}

async function rpc(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal | null) {
  const revision = cloudIdentityRevision();
  const query = cloud.rpc(name, args);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (revision !== cloudIdentityRevision()) throw new DOMException("Аккаунт изменился", "AbortError");
  if (error) {
    if (signal?.aborted) throw new DOMException("Запрос отменён", "AbortError");
    if (error.code === "42501" || error.code === "PGRST301" || error.code === "PGRST303") throw new Error("Вход истёк. Войдите в аккаунт снова.");
    throw new CloudUnavailableError("Не удалось подтвердить операцию в облаке. Проверьте сеть и повторите запрос.");
  }
  return data;
}

const pendingMemory = new Map<string, Pending>();
export function clearPendingMemory() { pendingMemory.clear(); }
async function pendingKey() {
  const { data, error } = await cloud.auth.getSession();
  if (error || !data.session) throw new Error("Войдите в аккаунт.");
  return `turkish-flashcards.cloud.pending.${data.session.user.id}`;
}
function readPending(key: string): Pending | null {
  try {
    const pending = JSON.parse(sessionStorage.getItem(key) ?? "null") as Pending | null ?? pendingMemory.get(key) ?? null;
    if (pending && (!Number.isSafeInteger(pending.cardId) || pending.cardId < 1 ||
        !/^[a-f0-9-]{36}$/i.test(pending.requestId) || !["correct", "incorrect"].includes(pending.result))) {
      throw new Error("Повреждён неподтверждённый ответ.");
    }
    return pending;
  }
  catch { return pendingMemory.get(key) ?? null; }
}
export async function reconcilePendingReview() {
  const revision = cloudIdentityRevision();
  const key = await pendingKey();
  const pending = readPending(key);
  if (!pending) return;
  const response = await rpc("cloud_review", { p_card_id: pending.cardId, p_result: pending.result, p_request_id: pending.requestId,
    p_expected_user_id: key.slice("turkish-flashcards.cloud.pending.".length) });
  if (revision !== cloudIdentityRevision()) throw new DOMException("Аккаунт изменился", "AbortError");
  const saved = readStudySession();
  const query = location.search.slice(1);
  saveStudySession({ key: saved?.key ?? studyKey(new URLSearchParams(query)), cardId: null, revealed: false,
    undo: { token: response.undoToken, cardId: pending.cardId, query } });
  writePending(key, null);
}
function writePending(key: string, pending: Pending | null) {
  if (pending) pendingMemory.set(key, pending); else pendingMemory.delete(key);
  try { if (pending) sessionStorage.setItem(key, JSON.stringify(pending)); else sessionStorage.removeItem(key); } catch { /* Memory handles retries in this tab. */ }
}
export async function cloudRequest<T>(path: string, options: RequestInit): Promise<T> {
  const url = new URL(path, "https://cloud-api.invalid");
  const params = url.searchParams;
  const filters = Object.fromEntries(["category", "partOfSpeech", "status", "tag"].filter(k => params.has(k)).map(k => [k, params.get(k)]));
  const body = typeof options.body === "string" ? JSON.parse(options.body) as Record<string, unknown> : {};
  const signal = options.signal;
  if (url.pathname === "/stats") return await rpc("cloud_stats", {}, signal) as T;
  if (url.pathname === "/entries/filters") return await rpc("cloud_filters", {}, signal) as T;
  if (url.pathname === "/entries" && !options.method) return await rpc("cloud_entries", {
    p_search: params.get("search") ?? "", p_filters: filters,
    p_limit: Math.min(100, Number(params.get("limit") || 50)), p_offset: Number(params.get("offset") || 0),
  }, signal) as T;
  if (url.pathname === "/cards/next") {
    // Route changes and page reloads must settle an ambiguous mutation before another card can be rated.
    await reconcilePendingReview();
    return await rpc("cloud_next_card", { p_direction: params.get("direction"), p_filters: filters,
      p_mode: params.get("mode") || "all", p_card_id: Number(params.get("cardId")) || null }, signal) as T;
  }
  if (url.pathname === "/reviews") {
    const key = await pendingKey();
    let pending = readPending(key);
    if (pending && (pending.cardId !== body.cardId || pending.result !== body.result)) {
      throw new Error("Сначала подтвердите предыдущий ответ: повторите его оценку. Его результат пока неизвестен.");
    }
    pending ??= { requestId: crypto.randomUUID(), cardId: Number(body.cardId), result: body.result as Pending["result"] };
    writePending(key, pending);
    const response = await rpc("cloud_review", { p_card_id: pending.cardId, p_result: pending.result, p_request_id: pending.requestId,
      p_expected_user_id: key.slice("turkish-flashcards.cloud.pending.".length) });
    writePending(key, null);
    return response as T;
  }
  if (url.pathname === "/reviews/undo") return await rpc("cloud_undo", { p_token: body.token }) as T;
  throw new Error("Эта операция пока недоступна в облачном пилоте.");
}
