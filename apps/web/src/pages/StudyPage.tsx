import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Pencil, RotateCcw, SlidersHorizontal, Undo2, X } from "lucide-react";
import { fetchEntryFilters, fetchNextCard, submitReview, undoLastReview, type CardDirection,
  type EntryFilterOptions, type QueueStats, type ReviewResult, type StudyCard, type StudyMode } from "../api";
import { readStudySession, saveStudySession, studyKey, studyShortcut, type StudyUndo } from "../studySession";

const emptyQueue: QueueStats = { accuracyToday: null, correctToday: 0, due: 0,
  isDoneToday: false, newAvailable: 0, newTotal: 0, newUsedToday: 0, reviewedToday: 0 };

function highlightTerm(text: string, term: string) {
  const index = text.toLocaleLowerCase("tr-TR").indexOf(term.toLocaleLowerCase("tr-TR"));
  return index < 0 ? text : <>{text.slice(0, index)}<strong>{text.slice(index, index + term.length)}</strong>{text.slice(index + term.length)}</>;
}

export function StudyPage() {
  const [params, setParams] = useSearchParams();
  const direction: CardDirection = params.get("direction") === "ru-tr" ? "ru-tr" : "tr-ru";
  const mode: StudyMode = params.get("mode") === "review" ? "review" : params.get("mode") === "new" ? "new" : "all";
  const category = params.get("category") ?? "";
  const partOfSpeech = params.get("partOfSpeech") ?? "";
  const tag = params.get("tag") ?? "";
  const query = params.toString();
  const key = studyKey(params);
  const filterCount = [category, partOfSpeech, tag].filter(Boolean).length;
  const [card, setCard] = useState<StudyCard | null>(null);
  const [filterOptions, setFilterOptions] = useState<EntryFilterOptions>({ categories: [], partsOfSpeech: [], tags: [] });
  const [queue, setQueue] = useState<QueueStats>(emptyQueue);
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [undo, setUndo] = useState<StudyUndo | null>(() => readStudySession()?.undo ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    if (!card || mutationPending.current || !revealed || status !== "ready") return;
    mutationPending.current = true; setIsSubmitting(true);
    saveStudySession({ key, cardId: null, revealed: false, undo });
    try {
      const schedule = await submitReview(card.id, result);
      const nextUndo = { token: schedule.undoToken, cardId: card.id, query };
      saveStudySession({ key, cardId: null, revealed: false, undo: nextUndo });
      if (!mounted.current || currentKey.current !== key) return;
      setUndo(nextUndo);
      setFeedback(result === "correct" ? "Верно. Ответ сохранён" : "Повтор через 5 минут");
      await loadCard();
    } catch (error) {
      if (mounted.current) { setFeedback(error instanceof Error ? error.message : "Не удалось сохранить ответ."); setStatus("error"); }
    } finally { mutationPending.current = false; if (mounted.current) setIsSubmitting(false); }
  };

  const undoRating = async () => {
    if (!undo || mutationPending.current) return;
    mutationPending.current = true; setIsSubmitting(true);
    try {
      await undoLastReview(undo.token);
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

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editing = Boolean(target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], details[open]"));
      const action = studyShortcut(event, editing);
      if (action === "undo" && undo && !isSubmitting) { event.preventDefault(); void undoRating(); }
      else if (status === "ready" && !isSubmitting) {
        if (action === "reveal" && !revealed && !target?.closest("button, a, summary")) {
          event.preventDefault(); setRevealed(true);
        } else if ((action === "correct" || action === "incorrect") && revealed) {
          event.preventDefault(); void rateCard(action);
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  });

  const prompt = (direction === "tr-ru" ? card?.turkish : card?.russian) ?? "";
  const answer = direction === "tr-ru" ? card?.russian : card?.turkish;
  const returnTo = `/study${query ? `?${query}` : ""}`;
  const modeLabel = mode === "review" ? "Повторение" : mode === "new" ? "Новые слова" : "Все карточки";

  return <section className="pageStack studyPage">
    <header className="pageHeading"><h1>Учёба</h1><span className="pageSubtitle">{modeLabel} · {direction === "tr-ru" ? "TR → RU" : "RU → TR"}</span></header>
    <div className="studyControls">
      <div className="segmentedControl" aria-label="Направление перевода">
        <button aria-pressed={direction === "tr-ru"} disabled={isSubmitting} onClick={() => change("direction", "tr-ru")} type="button">TR → RU</button>
        <button aria-pressed={direction === "ru-tr"} disabled={isSubmitting} onClick={() => change("direction", "ru-tr")} type="button">RU → TR</button>
      </div>
      <div className="studyTools">
        <button className="secondaryButton undoReviewButton" aria-label="Отменить последнюю оценку" disabled={!undo || isSubmitting || status === "loading"} onClick={() => void undoRating()} title="Отменить последнюю оценку (Ctrl/Cmd + Z)"><Undo2 size={17} /><span>Отменить оценку</span></button>
        <details className="filterDisclosure studyFilterDisclosure">
          <summary><SlidersHorizontal size={17} />Фильтры{filterCount > 0 && <span className="filterCount">{filterCount}</span>}</summary>
          <div className="studyFilters">
            <label className="statusFilter"><span>Режим занятия</span><select value={mode} disabled={isSubmitting} onChange={e => change("mode", e.target.value)}><option value="all">Все карточки</option><option value="review">Только повторение</option><option value="new">Только новые</option></select></label>
            <label className="statusFilter"><span>Категория</span><select value={category} disabled={isSubmitting} onChange={e => change("category", e.target.value)}><option value="">Все</option>{filterOptions.categories.map(value => <option key={value}>{value}</option>)}</select></label>
            <label className="statusFilter"><span>Часть речи</span><select value={partOfSpeech} disabled={isSubmitting} onChange={e => change("partOfSpeech", e.target.value)}><option value="">Все</option>{filterOptions.partsOfSpeech.map(value => <option key={value}>{value}</option>)}</select></label>
            <label className="statusFilter"><span>Тег</span><select value={tag} disabled={isSubmitting} onChange={e => change("tag", e.target.value)}><option value="">Все</option>{filterOptions.tags.map(value => <option key={value}>{value}</option>)}</select></label>
            {filterCount > 0 && <button className="textButton" type="button" disabled={isSubmitting} onClick={() => { setFeedback(""); setParams({ direction, mode }, { replace: true }); }}>Сбросить фильтры</button>}
          </div>
        </details>
      </div>
    </div>
    <div className="feedbackSlot" aria-live="polite">{feedback}</div>
    <div className="studyPreview" aria-busy={status === "loading"}>
      {status === "loading" && <p className="statusMessage" role="status">Выбираем карточку…</p>}
      {status === "error" && <div className="donePanel"><p className="errorMessage" role="alert">Не удалось загрузить карточку или сохранить ответ.</p><button className="secondaryButton" onClick={() => void loadCard()}><RotateCcw size={16} />Повторить</button></div>}
      {status === "done" && <div className="donePanel"><h2>{mode === "review" ? "Сейчас повторять нечего" : mode === "new" ? "Новых карточек нет" : "Очередь пуста"}</h2><p className="statusMessage">{filterCount > 0 ? "По выбранным фильтрам нет доступных карточек." : "Карточки для повторения появятся, когда подойдёт их время."}</p><div className="updateActions"><button className="secondaryButton" onClick={() => void loadCard()}><RotateCcw size={16} />Проверить снова</button>{mode !== "all" && <button className="secondaryButton" onClick={() => change("mode", "all")}>Все карточки</button>}</div></div>}
      {status === "ready" && card && <div className="studyCardLayout">
        <div className="cardPromptPane"><p className="cardLabel">{card.category}</p><p className={`cardPrompt${prompt.length > 28 ? " longPrompt" : ""}`} lang={direction === "tr-ru" ? "tr" : "ru"}>{prompt}</p><p className="cardPartOfSpeech">{card.partOfSpeech}</p></div>
        <div className={`cardAnswerPane${revealed ? " isRevealed" : ""}`}>
          {revealed ? <div className="cardAnswer"><div className="answerHeader"><span>Перевод</span><Link className="editHintButton" aria-label="Редактировать эту карточку" title="Редактировать эту карточку" to={`/card/${card.entryId}#edit`} state={{ returnTo }}><Pencil size={19} /></Link></div>
            <strong className="answerTranslation" lang={direction === "tr-ru" ? "ru" : "tr"}>{answer}</strong>
            {card.exampleTurkish && card.exampleRussian && <div className="cardExample"><p lang="tr">{highlightTerm(card.exampleTurkish, card.turkish)}</p><p>{card.exampleRussian}</p>{card.exampleSourceUrl && <a href={card.exampleSourceUrl} rel="noreferrer" target="_blank">{card.exampleSource || "Источник примера"}</a>}</div>}
          </div> : <p className="answerPlaceholder">Перевод появится после нажатия кнопки</p>}
        </div>
      </div>}
    </div>
    <div className="studyFooter"><div className="queueStrip" aria-label="Состояние очереди"><div><span>Сегодня</span><strong>{queue.reviewedToday}</strong></div><div><span>Повторы</span><strong>{queue.due}</strong></div><div><span>Новые</span><strong>{queue.newAvailable}</strong></div><div><span>Точность</span><strong>{queue.accuracyToday === null ? "—" : `${queue.accuracyToday}%`}</strong></div></div><p className="shortcutHint"><kbd>Пробел</kbd> перевод · <kbd>1</kbd> неверно · <kbd>2</kbd> верно · <kbd>Ctrl/Cmd Z</kbd> отмена</p></div>
    <div className="reviewActions" aria-label="Оценка ответа">
      {!revealed ? <button className="primaryButton revealButton" disabled={status !== "ready" || isSubmitting} onClick={() => setRevealed(true)} type="button">Показать перевод</button> : <><button className="incorrectButton" disabled={isSubmitting || status !== "ready"} onClick={() => void rateCard("incorrect")} type="button"><X size={20} />Неверно</button><button className="correctButton" disabled={isSubmitting || status !== "ready"} onClick={() => void rateCard("correct")} type="button"><Check size={20} />Верно</button></>}
    </div>
  </section>;
}
