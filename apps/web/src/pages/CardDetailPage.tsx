import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, Check, RotateCcw, Save } from "lucide-react";
import { applyEntryRefreshSuggestion, fetchEntryDetail, fetchEntryRefreshSuggestion, setEntryStatus,
  updateEntry, type EntryDetail, type EntryRefreshSuggestion, type EntryStatus } from "../api";
import { buildEntryPatch, emptyDraft, entryDraft, fieldLabels, historyValue, mergeEntryDraft,
  readEntryDraft, saveEntryDraft, statusLabels, type EntryDraft } from "../entryEditor";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ru-RU") : "ещё не назначено";
}
function FieldRow({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

export function CardDetailPage() {
  const location = useLocation();
  const returnTo = typeof location.state?.returnTo === "string" && /^\/(study|dictionary)(\?|$)/.test(location.state.returnTo)
    ? location.state.returnTo as string : "/dictionary";
  const numericEntryId = Number(useParams().entryId);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);
  const baseline = useRef<EntryDraft>(emptyDraft);
  const [message, setMessage] = useState("");
  const [refreshSuggestion, setRefreshSuggestion] = useState<EntryRefreshSuggestion | null>(null);
  const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const acceptDetail = (data: EntryDetail, resetDraft = false) => {
    const previous = baseline.current;
    const next = entryDraft(data.effective);
    setDraft(current => resetDraft ? next : mergeEntryDraft(current, previous, next));
    baseline.current = next;
    setDetail(data);
  };

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading"); setMessage(""); setRefreshSuggestion(null);
    fetchEntryDetail(numericEntryId, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      baseline.current = entryDraft(data.effective);
      setDraft(readEntryDraft(numericEntryId, baseline.current));
      setDetail(data); setStatus("ready");
    }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [numericEntryId, retry]);

  useEffect(() => {
    if (status === "ready" && detail?.effective.id === numericEntryId)
      saveEntryDraft(numericEntryId, draft, baseline.current);
  }, [detail, draft, numericEntryId, status]);

  useEffect(() => {
    if (status === "ready" && location.hash === "#edit") document.getElementById("edit")?.scrollIntoView({ block: "start" });
  }, [status, location.hash]);

  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyS" && status === "ready") {
        event.preventDefault(); if (!isSaving && !isRefreshing) formRef.current?.requestSubmit();
      }
    };
    document.addEventListener("keydown", save);
    return () => document.removeEventListener("keydown", save);
  }, [isRefreshing, isSaving, status]);

  const saveForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || isSaving || isRefreshing) return;
    if (!draft.turkish.trim() || !draft.russian.trim()) { setMessage("Укажите турецкое слово и русский перевод."); return; }
    const patch = buildEntryPatch(draft, baseline.current);
    if (!Object.keys(patch).length) { setMessage("Изменений для сохранения нет."); return; }
    setIsSaving(true); setMessage("");
    try {
      const updated = await updateEntry(detail.effective.id, patch);
      acceptDetail(updated, true); setRefreshSuggestion(null); setMessage("Изменения сохранены.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить изменения."); }
    finally { setIsSaving(false); }
  };

  const changeStatus = async (nextStatus: EntryStatus) => {
    if (!detail || isSaving || isRefreshing) return;
    setIsSaving(true); setMessage("");
    try {
      acceptDetail(await setEntryStatus(detail.effective.id, nextStatus));
      setMessage("Статус обновлён. Несохранённые правки остались в редакторе.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось обновить статус."); }
    finally { setIsSaving(false); }
  };

  const findRefreshSuggestion = async () => {
    if (!detail) return;
    setIsRefreshing(true); setMessage(""); setRefreshSuggestion(null);
    try {
      const suggestion = await fetchEntryRefreshSuggestion(detail.effective.id);
      setRefreshSuggestion(suggestion);
      setMessage(suggestion.changes.length ? "В локальных данных есть отличия. Проверьте предложение ниже." : "Новых отличий в локальных словарях нет.");
    } catch { setMessage("В локальных словарях подходящая запись не найдена. Для поиска в интернете откройте словарь."); }
    finally { setIsRefreshing(false); }
  };

  const applyRefreshSuggestion = async () => {
    if (!detail || !refreshSuggestion) return;
    setIsRefreshing(true); setMessage("");
    try {
      const result = await applyEntryRefreshSuggestion(detail.effective.id);
      acceptDetail(result.detail); setRefreshSuggestion(null);
      setMessage("Предложение применено. Ваш черновик сохранён.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось применить предложение."); }
    finally { setIsRefreshing(false); }
  };

  if (status === "loading") return <p className="statusMessage" role="status">Загружаем карточку…</p>;
  if (status === "error" || !detail) return <section className="pageStack"><p className="errorMessage" role="alert">Не удалось загрузить карточку.</p><button className="secondaryButton" onClick={() => setRetry(value => value + 1)}><RotateCcw size={17} />Повторить</button><Link to={returnTo}>Вернуться</Link></section>;
  const { effective } = detail;
  const dirty = Object.keys(buildEntryPatch(draft, baseline.current)).length > 0;
  const busy = isSaving || isRefreshing;
  const updateField = (field: keyof EntryDraft, value: string) => { setMessage(""); setDraft(current => ({ ...current, [field]: value })); };
  const hasOverrideExample = detail.examples.some(example => example.layer === "override");
  const examples = detail.examples.filter(example => example.layer === (hasOverrideExample ? "override" : "base") && (example.turkish || example.russian));

  return <section className="pageStack cardDetailPage">
    <Link className="backLink" to={returnTo}><ArrowLeft size={17} />{returnTo.startsWith("/study") ? "К той же карточке в занятии" : "В словарь"}</Link>
    <header className="objectHeader"><div><h1>{effective.turkish}</h1><p className="lead">{effective.russian}</p></div><span className={`statusBadge status${effective.status}`}>{statusLabels[effective.status]}</span></header>

    <form ref={formRef} className="emptyPanel editForm" id="edit" onSubmit={saveForm}>
      <div className="pageHeading"><h2>Редактирование</h2><span className="pageSubtitle">{dirty ? "Есть несохранённые правки" : "Все изменения сохранены"}</span></div>
      <div className="editorFields">
        <label><span>Турецкое слово *</span><input name="turkish" lang="tr" required value={draft.turkish} disabled={busy} onChange={e => updateField("turkish", e.target.value)} /></label>
        <label><span>Русский перевод *</span><textarea name="russian" required rows={2} value={draft.russian} disabled={busy} onChange={e => updateField("russian", e.target.value)} /></label>
        <label><span>Часть речи</span><input name="partOfSpeech" value={draft.partOfSpeech} disabled={busy} onChange={e => updateField("partOfSpeech", e.target.value)} /></label>
        <label><span>Категория</span><input name="category" value={draft.category} disabled={busy} onChange={e => updateField("category", e.target.value)} /></label>
        <label className="wideField"><span>Теги через запятую</span><input name="tags" value={draft.tags} disabled={busy} onChange={e => updateField("tags", e.target.value)} /></label>
        <label><span>Пример на турецком</span><textarea name="exampleTurkish" lang="tr" rows={3} value={draft.exampleTurkish} disabled={busy} onChange={e => updateField("exampleTurkish", e.target.value)} /></label>
        <label><span>Перевод примера</span><textarea name="exampleRussian" rows={3} value={draft.exampleRussian} disabled={busy} onChange={e => updateField("exampleRussian", e.target.value)} /></label>
      </div>
      <p className="statusMessage">Черновик сохраняется в этой вкладке. Изменение статуса его не удалит.</p>
      <div className="editorSaveBar"><div className="updateActions"><button className="primaryButton" disabled={busy || !dirty} type="submit"><Save size={17} />{isSaving ? "Сохраняем…" : "Сохранить"}</button><button className="secondaryButton" disabled={busy || !dirty} onClick={() => { setDraft(baseline.current); setMessage("Правки сброшены."); }} type="button">Сбросить правки</button></div><span className="saveShortcut">Ctrl/Cmd + S</span></div>
      <p className="statusMessage" role="status" aria-live="polite">{message || (dirty ? "Правки ещё не применены к карточке." : "")}</p>
    </form>

    <section className="cardSection emptyPanel"><h2>Учебный прогресс</h2><div className="detailsGrid"><FieldRow label="Успешных повторений подряд (оба направления)" value={String(detail.review.repetitions)} /><FieldRow label="Ближайшее повторение" value={formatDate(detail.review.dueAt)} /></div></section>

    <details className="cardDisclosure"><summary>Предложения из локальных словарей</summary><div className="disclosureBody"><p className="statusMessage">Сравнение с подборкой Kaikki и примерами Tatoeba, уже сохранёнными в приложении. Интернет-поиск находится в словаре.</p><button className="secondaryButton" disabled={busy} onClick={findRefreshSuggestion}>Проверить локальные словари</button>
      {refreshSuggestion && <div className="refreshSuggestionPanel"><strong>{refreshSuggestion.sourceName}</strong>{refreshSuggestion.changes.length ? <><div className="itemList">{refreshSuggestion.changes.map(change => <div className="historyItem" key={change.field}><strong>{fieldLabels[change.field] ?? change.field}</strong><small>{change.from || "не задано"} → {change.to}</small></div>)}</div><button className="secondaryButton" disabled={busy} onClick={applyRefreshSuggestion}><Check size={17} />Применить предложение</button></> : <p className="statusMessage">Отличий нет.</p>}</div>}
    </div></details>

    <details className="cardDisclosure"><summary>Участие в обучении и архив</summary><div className="disclosureBody"><p className="statusMessage">Отключённые и архивные карточки не участвуют в занятиях. Их можно вернуть в любой момент.</p><div className="updateActions"><button className="secondaryButton" disabled={busy} onClick={() => changeStatus(effective.status === "ACTIVE" ? "DISABLED" : "ACTIVE")}>{effective.status === "ACTIVE" ? "Исключить из занятий" : "Вернуть в занятия"}</button><button className="secondaryButton" disabled={busy || effective.status === "ARCHIVED"} onClick={() => changeStatus("ARCHIVED")}>Переместить в архив</button></div></div></details>

    <details className="cardDisclosure"><summary>Источники и подробности карточки</summary><div className="disclosureBody"><div className="detailsGrid"><FieldRow label="Источник слова" value={effective.sourceName} /><FieldRow label="Создана" value={formatDate(effective.createdAt)} /><FieldRow label="Изменена" value={formatDate(effective.updatedAt)} /><FieldRow label="Последний ответ" value={formatDate(detail.review.lastReviewedAt)} /><FieldRow label="Коэффициент роста интервала" value={detail.review.easeFactor?.toFixed(2) ?? "нет данных"} /><FieldRow label="Максимальный интервал, дней" value={detail.review.intervalDays?.toFixed(1) ?? "нет данных"} /></div>
      <h3>Переводы и их источники</h3><div className="itemList">{detail.translations.map(translation => <div className="sourceItem" key={translation.id}><strong>{translation.text}</strong><span>{translation.layer === "override" ? "Ваш перевод" : "Исходный перевод"} · {translation.sourceName || effective.sourceName}</span></div>)}</div>
      <h3>Примеры</h3>{!examples.length && <p className="statusMessage">Пример не задан.</p>}{examples.map(example => <div className="sourceItem" key={example.id}><strong lang="tr">{example.turkish}</strong><span>{example.russian}</span><small>{example.sourceName || (example.layer === "override" ? "Ваш пример" : "Исходный пример")}</small></div>)}
    </div></details>

    <details className="cardDisclosure"><summary>История изменений ({detail.history.length})</summary><div className="disclosureBody">{!detail.history.length ? <p className="statusMessage">Изменений пока нет.</p> : <div className="itemList">{detail.history.map(item => <div className="historyItem" key={item.id}><strong>{fieldLabels[item.field] ?? item.field}</strong><span>{formatDate(item.changedAt)}</span><small>{historyValue(item.oldValueJson)} → {historyValue(item.newValueJson)}</small></div>)}</div>}</div></details>
  </section>;
}
