import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Pencil, RotateCcw } from "lucide-react";
import { StudyReviewActions } from "../components/StudyReviewActions";
import { EntryFilterFields } from "../components/EntryFilterFields";
import { StudyFilters } from "../components/StudyFilters";
import { TwoPositionSwitch } from "../components/TwoPositionSwitch";
import { StudyStats } from "../components/StudyStats";
import { StudyAnswer } from "../components/StudyAnswer";
import { StudyPrompt } from "../components/StudyPrompt";
import { useStudyShortcuts } from "../components/useStudyShortcuts";
import { fetchEntryFilters, fetchNextCard, submitReview, undoLastReview, type CardDirection,
  type EntryFilterOptions, type QueueStats, type ReviewResult, type StudyCard, type StudyMode } from "../api";
import { readStudySession, saveStudySession, studyKey, type StudyUndo } from "../studySession";
import { cloudIdentityRevision } from "../cloud/identity";

const emptyQueue: QueueStats = { accuracyToday: null, correctToday: 0, due: 0,
  isDoneToday: false, newAvailable: 0, newTotal: 0, newUsedToday: 0, reviewedToday: 0 };

function highlightTerm(text: string, term: string) {
  const index = text.toLocaleLowerCase("tr-TR").indexOf(term.toLocaleLowerCase("tr-TR"));
  return index < 0 ? text : <>{text.slice(0, index)}<strong>{text.slice(index, index + term.length)}</strong>{text.slice(index + term.length)}</>;
}

export function StudyPage({ readOnly = false }: { readOnly?: boolean }) {
  const [params, setParams] = useSearchParams();
  const direction: CardDirection = params.get("direction") === "ru-tr" ? "ru-tr" : "tr-ru";
  const mode: StudyMode = params.get("mode") === "review" ? "review" : params.get("mode") === "new" ? "new" : "all";
  const category = params.get("category") ?? "";
  const partOfSpeech = params.get("partOfSpeech") ?? "";
  const tag = params.get("tag") ?? "";
  const query = params.toString();
  const key = studyKey(params);
  const filterCount = [category, partOfSpeech, tag].filter(Boolean).length + (mode === "all" ? 0 : 1);
  const [card, setCard] = useState<StudyCard | null>(null);
  const [filterOptions, setFilterOptions] = useState<EntryFilterOptions>({ categories: [], partsOfSpeech: [], tags: [] });
  const [queue, setQueue] = useState<QueueStats>(emptyQueue);
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [undo, setUndo] = useState<StudyUndo | null>(() => readStudySession()?.undo ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedReview, setFailedReview] = useState<ReviewResult | null>(null);
  const [status, setStatus] = useState<"done" | "error" | "loading" | "ready">("loading");
  const request = useRef<AbortController | null>(null);
  const loadedKey = useRef("");
  const currentKey = useRef(key);
  currentKey.current = key;
  const mounted = useRef(false);
  const mutationPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    fetchEntryFilters(controller.signal).then(setFilterOptions).catch(() => {});
    return () => { mounted.current = false; controller.abort(); request.current?.abort(); };
  }, []);

  const loadCard = useCallback(async (preferredCardId?: number, restoreRevealed = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus("loading"); setRevealed(false);
    try {
      const data = await fetchNextCard(direction, { category: category || undefined,
        partOfSpeech: partOfSpeech || undefined, tag: tag || undefined }, controller.signal,
        { mode, cardId: preferredCardId });
      if (controller.signal.aborted) return;
      loadedKey.current = key;
      setCard(data.card); setQueue(data.queue);
      if (import.meta.env.VITE_APP_MODE === "cloud") { setUndo(readStudySession()?.undo ?? null); setFailedReview(null); }
      setRevealed(Boolean(restoreRevealed && data.card?.id === preferredCardId));
      setStatus(data.card ? "ready" : "done");
    } catch { if (!controller.signal.aborted) setStatus("error"); }
  }, [category, direction, key, mode, partOfSpeech, tag]);

  useEffect(() => {
    const saved = readStudySession();
    void loadCard(saved?.key === key ? saved.cardId ?? undefined : undefined, saved?.key === key && saved.revealed);
    return () => request.current?.abort();
  }, [key, loadCard]);

  useEffect(() => {
    if (loadedKey.current === key && (status === "ready" || status === "done"))
      saveStudySession({ key, cardId: card?.id ?? null, revealed, undo });
  }, [card, key, revealed, status, undo]);

  const change = (name: string, value: string) => {
    setFeedback("");
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(name, value); else next.delete(name);
      return next;
    }, { replace: true });
  };

  const rateCard = async (result: ReviewResult) => {
    if (!card || mutationPending.current || !revealed || (status !== "ready" && !failedReview)) return;
    mutationPending.current = true; setIsSubmitting(true);
    const identityRevision = cloudIdentityRevision();
    saveStudySession({ key, cardId: null, revealed: false, undo });
    try {
      const schedule = await submitReview(card.id, result);
      if (identityRevision !== cloudIdentityRevision()) return;
      setFailedReview(null);
      const nextUndo = { token: schedule.undoToken, cardId: card.id, query };
      saveStudySession({ key, cardId: null, revealed: false, undo: nextUndo });
      if (!mounted.current || currentKey.current !== key) return;
      setUndo(nextUndo);
      setFeedback(result === "correct" ? "Верно. Ответ сохранён" : "Повтор через 5 минут");
      await loadCard();
    } catch (error) {
      if (mounted.current) { setFailedReview(import.meta.env.VITE_APP_MODE === "cloud" ? result : null); setFeedback(error instanceof Error ? error.message : "Не удалось сохранить ответ."); setStatus("error"); }
    } finally { mutationPending.current = false; if (mounted.current) setIsSubmitting(false); }
  };

  const undoRating = async () => {
    if (!undo || mutationPending.current) return;
    mutationPending.current = true; setIsSubmitting(true);
    const identityRevision = cloudIdentityRevision();
    try {
      await undoLastReview(undo.token);
      if (identityRevision !== cloudIdentityRevision()) return;
      const restoredParams = new URLSearchParams(undo.query);
      const restoredKey = studyKey(restoredParams);
      saveStudySession({ key: restoredKey, cardId: undo.cardId, revealed: true, undo: null });
      if (!mounted.current) return;
      setUndo(null); setFeedback("Оценка отменена. Карточка и статистика восстановлены");
      if (restoredKey !== key) setParams(restoredParams, { replace: true });
      else await loadCard(undo.cardId, true);
    } catch (error) {
      if (mounted.current) setFeedback(error instanceof Error ? error.message : "Не удалось отменить оценку.");
    } finally { mutationPending.current = false; if (mounted.current) setIsSubmitting(false); }
  };

  useStudyShortcuts({
    onReveal: status === "ready" && !isSubmitting && !revealed ? () => setRevealed(true) : undefined,
    onRate: status === "ready" && !isSubmitting && revealed ? correct => void rateCard(correct ? "correct" : "incorrect") : undefined,
    onUndo: undo && !isSubmitting ? () => void undoRating() : undefined,
  });

  const prompt = (direction === "tr-ru" ? card?.turkish : card?.russian) ?? "";
  const answer = direction === "tr-ru" ? card?.russian : card?.turkish;
  const returnTo = `/study${query ? `?${query}` : ""}`;

  return <section className="pageStack studyPage">
    <header className="studyToolbar"><h1>Учёба</h1>
    <div className="studyControls">
      <TwoPositionSwitch label="Направление перевода: RU → TR" left="TR → RU" right="RU → TR" checked={direction === "ru-tr"} disabled={isSubmitting} onChange={checked => change("direction", checked ? "ru-tr" : "tr-ru")} />
      <div className="studyTools">
        <StudyFilters count={filterCount}>
            <label className="statusFilter"><span>Режим занятия</span><select value={mode} disabled={isSubmitting} onChange={e => change("mode", e.target.value)}><option value="all">Все карточки</option><option value="review">Только повторение</option><option value="new">Только новые</option></select></label>
            <EntryFilterFields options={filterOptions} values={{ category, partOfSpeech, tag }} onChange={change} disabled={isSubmitting} />
            {filterCount > 0 && <button className="textButton" type="button" disabled={isSubmitting} onClick={() => { setFeedback(""); setParams({ direction }, { replace: true }); }}>Сбросить фильтры</button>}
        </StudyFilters>
      </div>
    </div>
    </header>
    <div className="feedbackSlot" aria-live="polite">{feedback}</div>
    <div className="studyPreview" aria-busy={status === "loading"}>
      {status === "loading" && <p className="statusMessage" role="status">Выбираем карточку…</p>}
      {status === "error" && <div className="donePanel"><p className="errorMessage" role="alert">{failedReview ? "Результат сохранения ответа пока не подтверждён." : "Не удалось загрузить карточку."}</p><button className="secondaryButton" disabled={isSubmitting} onClick={() => failedReview ? void rateCard(failedReview) : void loadCard()}><RotateCcw size={16} />{failedReview ? "Проверить сохранение ответа" : "Повторить"}</button></div>}
      {status === "done" && <div className="donePanel"><h2>{mode === "review" ? "Сейчас повторять нечего" : mode === "new" ? "Новых карточек нет" : "Очередь пуста"}</h2><p className="statusMessage">{filterCount > 0 ? "По выбранным фильтрам нет доступных карточек." : "Карточки для повторения появятся, когда подойдёт их время."}</p><div className="updateActions"><button className="secondaryButton" onClick={() => void loadCard()}><RotateCcw size={16} />Проверить снова</button>{mode !== "all" && <button className="secondaryButton" onClick={() => change("mode", "all")}>Все карточки</button>}</div></div>}
      {status === "ready" && card && <div className="studyCardLayout">
        <StudyPrompt><p className="cardLabel">{card.category}</p><p className={`cardPrompt${prompt.length > 28 ? " longPrompt" : ""}`} lang={direction === "tr-ru" ? "tr" : "ru"}>{prompt}</p><p className="cardPartOfSpeech">{card.partOfSpeech}</p></StudyPrompt>
        <div className={`cardAnswerPane${revealed ? " isRevealed" : ""}`}>
          {revealed ? <StudyAnswer><div className="answerHeader"><span>Перевод</span>{!readOnly && <Link className="editHintButton" aria-label="Редактировать эту карточку" title="Редактировать эту карточку" to={`/card/${card.entryId}#edit`} state={{ returnTo }}><Pencil size={19} /></Link>}</div>
            <strong className="answerTranslation" lang={direction === "tr-ru" ? "ru" : "tr"}>{answer}</strong>
            {card.exampleTurkish && card.exampleRussian && <div className="cardExample"><p lang="tr">{highlightTerm(card.exampleTurkish, card.turkish)}</p><p>{card.exampleRussian}</p>{card.exampleSourceUrl && <a href={card.exampleSourceUrl} rel="noreferrer" target="_blank">{card.exampleSource || "Источник примера"}</a>}</div>}
          </StudyAnswer> : <p className="answerPlaceholder">Перевод появится после нажатия кнопки</p>}
        </div>
      </div>}
    </div>
    <StudyStats><div className="queueStrip" aria-label="Состояние очереди"><div><span>Сегодня</span><strong>{queue.reviewedToday}</strong></div><div><span>Повторы</span><strong>{queue.due}</strong></div><div><span>Новые</span><strong>{queue.newAvailable}</strong></div><div><span>Точность</span><strong>{queue.accuracyToday === null ? "—" : `${queue.accuracyToday}%`}</strong></div></div></StudyStats>
    <p className="shortcutHint"><kbd>Пробел</kbd> перевод · <kbd>1</kbd> неверно · <kbd>2</kbd> верно · <kbd>Ctrl/Cmd Z</kbd> отмена</p>
    <StudyReviewActions revealed={revealed} ready={status === "ready"} busy={isSubmitting} canUndo={Boolean(undo) && status !== "loading"} onReveal={() => setRevealed(true)} onRate={correct => void rateCard(correct ? "correct" : "incorrect")} onUndo={() => void undoRating()} />
  </section>;
}
