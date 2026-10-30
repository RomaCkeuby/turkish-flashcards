import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createSiteHandler } from "./hosting.ts";
import { searchAllOnlineSources, confirmOnlineWord } from "./onlineDictionary.ts";

import {
  applyEntryRefresh,
  suggestEntryRefresh,
} from "./cardRefresh.ts";
import {
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
  undoReview,
  EntryValidationError,
  setEntryStatus,
  type CardDirection,
  type EntryFilters,
  type EntryStatus,
  type ReviewResult,
} from "./database.ts";
import {
  applyDictionaryImportPackage,
  prepareDictionaryImportPackage,
} from "./dictionaryImport.ts";
import {
  applyUpdate,
  getUpdateStatus,
  markWeeklyUpdateCheck,
  previewUpdate,
  rollbackLastUpdate,
  runAutomaticWeeklyUpdateCheck,
  UpdateRollbackConflictError,
} from "./updatePackage.ts";

const production = process.env.NODE_ENV === "production";
const host = process.env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? 3001);
const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
if (production && (!process.env.DATABASE_PATH || !isAbsolute(process.env.DATABASE_PATH))) {
  throw new Error("Для онлайн-запуска задайте абсолютный DATABASE_PATH на постоянном диске.");
}
if (production && !existsSync(`${webRoot}/index.html`)) {
  throw new Error("Не найдена сборка сайта. Сначала выполните pnpm build.");
}
// Validate access protection before opening or changing the database.
const siteHandler = createSiteHandler(handleRequest, {
  production, webRoot, username: process.env.APP_USERNAME, password: process.env.APP_PASSWORD,
});
const database = openDatabase(process.env.DATABASE_PATH);

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function parseBoundedInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}

function parseEntryFilters(url: URL): EntryFilters {
  const status = url.searchParams.get("status");
  const entryStatus =
    status === "ACTIVE" || status === "DISABLED" || status === "ARCHIVED"
      ? status
      : undefined;

  return {
    category: url.searchParams.get("category") || undefined,
    partOfSpeech: url.searchParams.get("partOfSpeech") || undefined,
    status: entryStatus,
    tag: url.searchParams.get("tag") || undefined,
  };
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 10_000) {
      throw new Error("Тело запроса слишком большое.");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, null);
    return;
  }

  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/api/dictionary/online") {
    const query = (url.searchParams.get("query") ?? "").trim();
    if (query.length < 2 || query.length > 100) {
      sendJson(response, 400, { error: "Введите от 2 до 100 символов." });
      return;
    }
    try {
      sendJson(response, 200, await searchAllOnlineSources(query));
    } catch {
      sendJson(response, 502, { error: "Не удалось связаться с интернет-словарём. Проверьте подключение и повторите поиск." });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/dictionary/online/confirm") {
    let body: unknown;
    try { body = await readJsonBody(request); } catch {
      sendJson(response, 400, { error: "Некорректный JSON." }); return;
    }
    const id = typeof body === "object" && body !== null && "id" in body ? body.id : null;
    const exampleId = typeof body === "object" && body !== null && "exampleId" in body ? body.exampleId : undefined;
    const detail = typeof id === "string" && (exampleId === undefined || typeof exampleId === "string")
      ? confirmOnlineWord(database, id, exampleId) : null;
    sendJson(response, detail ? 200 : 409, detail ?? { error: "Предпросмотр устарел. Повторите поиск." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reviews") {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: "Некорректный JSON." });
      return;
    }

    if (typeof body !== "object" || body === null) {
      sendJson(response, 400, { error: "Некорректный результат карточки." });
      return;
    }

    const { cardId, result } = body as { cardId?: unknown; result?: unknown };
    if (
      !Number.isInteger(cardId) ||
      (result !== "correct" && result !== "incorrect")
    ) {
      sendJson(response, 400, { error: "Ожидались cardId и результат correct/incorrect." });
      return;
    }

    const schedule = recordReview(database, cardId as number, result as ReviewResult);
    sendJson(
      response,
      schedule ? 200 : 404,
      schedule ?? { error: "Карточка не найдена." },
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reviews/undo") {
    let body: unknown;
    try { body = await readJsonBody(request); } catch {
      sendJson(response, 400, { error: "Некорректный JSON." }); return;
    }
    const token = typeof body === "object" && body !== null && "token" in body ? body.token : undefined;
    const result = typeof token === "string" ? undoReview(database, token) : null;
    sendJson(response, result ? 200 : 409, result ?? { error: "Эту оценку уже нельзя отменить: состояние карточки изменилось." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/updates/apply") {
    sendJson(response, 200, applyUpdate(database));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/updates/rollback") {
    const rollback = rollbackLastUpdate(database);
    sendJson(response, rollback ? 200 : 404, rollback ?? { error: "Нет снимка для отката." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/updates/check") {
    sendJson(response, 200, markWeeklyUpdateCheck(database));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/dictionary/import/prepare") {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: "Некорректный JSON." });
      return;
    }

    const options = (typeof body === "object" && body !== null ? body : {}) as {
      limit?: unknown;
      query?: unknown;
    };
    sendJson(response, 200, prepareDictionaryImportPackage(database, {
      limit: typeof options.limit === "number" ? options.limit : undefined,
      query: typeof options.query === "string" ? options.query : undefined,
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/dictionary/import/apply") {
    sendJson(response, 200, applyDictionaryImportPackage(database));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/entries") {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: "Некорректный JSON." });
      return;
    }

    if (typeof body !== "object" || body === null) {
      sendJson(response, 400, { error: "Ожидались поля новой карточки." });
      return;
    }

    const created = createUserEntry(database, body as Parameters<typeof createUserEntry>[1]);
    sendJson(response, created ? 201 : 400, created ?? { error: "Нужно указать турецкое слово и русский перевод." });
    return;
  }

  const entryStatusMatch = url.pathname.match(/^\/api\/entries\/(\d+)\/status$/);
  if (request.method === "POST" && entryStatusMatch) {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: "Некорректный JSON." });
      return;
    }

    const { status } = (typeof body === "object" && body !== null ? body : {}) as {
      status?: unknown;
    };
    if (status !== "ACTIVE" && status !== "DISABLED" && status !== "ARCHIVED") {
      sendJson(response, 400, { error: "Ожидался статус ACTIVE, DISABLED или ARCHIVED." });
      return;
    }

    const detail = setEntryStatus(database, Number(entryStatusMatch[1]), status as EntryStatus);
    sendJson(response, detail ? 200 : 404, detail ?? { error: "Карточка не найдена." });
    return;
  }

  const entryRefreshApplyMatch = url.pathname.match(/^\/api\/entries\/(\d+)\/refresh-apply$/);
  if (request.method === "POST" && entryRefreshApplyMatch) {
    const result = applyEntryRefresh(database, Number(entryRefreshApplyMatch[1]));
    sendJson(response, result ? 200 : 404, result ?? { error: "Не удалось найти обновление для карточки." });
    return;
  }

  const entryPatchMatch = url.pathname.match(/^\/api\/entries\/(\d+)$/);
  if (request.method === "PATCH" && entryPatchMatch) {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { error: "Некорректный JSON." });
      return;
    }

    if (typeof body !== "object" || body === null) {
      sendJson(response, 400, { error: "Ожидались поля карточки." });
      return;
    }

    const detail = patchEntry(database, Number(entryPatchMatch[1]), body as Parameters<typeof patchEntry>[2]);
    sendJson(response, detail ? 200 : 404, detail ?? { error: "Карточка не найдена." });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Метод не поддерживается." });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (url.pathname === "/api/stats") {
    sendJson(response, 200, getStats(database));
    return;
  }

  if (url.pathname === "/api/updates/status") {
    sendJson(response, 200, getUpdateStatus(database));
    return;
  }

  if (url.pathname === "/api/updates/preview") {
    sendJson(response, 200, previewUpdate(database));
    return;
  }

  if (url.pathname === "/api/entries") {
    const search = url.searchParams.get("search") ?? "";
    const limit = parseBoundedInteger(url.searchParams.get("limit"), 50, 200);
    const offset = parseBoundedInteger(url.searchParams.get("offset"), 0, 10_000);
    const filters = parseEntryFilters(url);
    sendJson(response, 200, getEntries(database, search, Math.max(1, limit), offset, filters));
    return;
  }

  if (url.pathname === "/api/entries/filters") {
    sendJson(response, 200, getEntryFilterOptions(database));
    return;
  }

  const entryRefreshMatch = url.pathname.match(/^\/api\/entries\/(\d+)\/refresh-suggestion$/);
  if (entryRefreshMatch) {
    const suggestion = suggestEntryRefresh(database, Number(entryRefreshMatch[1]));
    sendJson(response, suggestion ? 200 : 404, suggestion ?? { error: "Обновление для карточки не найдено." });
    return;
  }

  const entryDetailMatch = url.pathname.match(/^\/api\/entries\/(\d+)$/);
  if (entryDetailMatch) {
    const detail = getEntryDetail(database, Number(entryDetailMatch[1]));
    sendJson(response, detail ? 200 : 404, detail ?? { error: "Карточка не найдена." });
    return;
  }

  if (url.pathname === "/api/cards/next") {
    const direction = url.searchParams.get("direction") ?? "tr-ru";
    if (direction !== "tr-ru" && direction !== "ru-tr") {
      sendJson(response, 400, { error: "Неизвестное направление карточки." });
      return;
    }

    const filters = parseEntryFilters(url);
    const now = new Date();
    const modeParam = url.searchParams.get("mode");
    const mode = modeParam === "new" || modeParam === "review" ? modeParam : "all";
    const preferred = Number(url.searchParams.get("cardId"));
    const card = getNextCard(database, direction as CardDirection, now, filters, mode,
      Number.isSafeInteger(preferred) && preferred > 0 ? preferred : undefined);
    sendJson(response, 200, {
      card: card ?? null,
      queue: getQueueStats(database, now, filters, direction as CardDirection),
    });
    return;
  }

  sendJson(response, 404, { error: "Маршрут не найден." });
}

const server = createServer((request, response) => {
  siteHandler(request, response).catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) {
      if (error instanceof EntryValidationError) {
        sendJson(response, 400, { error: error.message });
      } else if (error instanceof UpdateRollbackConflictError) {
        sendJson(response, 409, { error: error.message });
      } else {
        sendJson(response, 500, { error: "Внутренняя ошибка сервера." });
      }
    } else {
      response.end();
    }
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

server.listen(port, host, () => {
  runAutomaticWeeklyUpdateCheck(database);
  const stats = getStats(database);
  console.log(`Turkish Flashcards API: http://${host}:${port}`);
  console.log(`База готова: ${stats.entries} слов, ${stats.cards} карточек.`);
});
