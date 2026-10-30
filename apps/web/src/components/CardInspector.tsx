import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, Pencil } from "lucide-react";
import { fetchEntryDetail, type EntryDetail } from "../api";

export function CardInspector({ entryId }: { entryId: number }) {
  const location = useLocation();
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(false);
    fetchEntryDetail(entryId, controller.signal).then(data => {
      if (!controller.signal.aborted) setDetail(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [entryId, retry]);
  if (error) return <div className="inspectorBody"><p role="alert">Не удалось загрузить карточку.</p><button className="secondaryButton" onClick={() => setRetry(value => value + 1)}>Повторить</button></div>;
  if (!detail) return <p className="inspectorBody statusMessage" role="status">Загружаем карточку…</p>;
  const word = detail.effective;
  const returnTo = location.pathname + location.search;
  return <div className="inspectorBody">
    <div className="inspectorHeading"><span className={`statusPill status${word.status}`}>{word.status === "ACTIVE" ? "Активна" : word.status === "DISABLED" ? "Отключена" : "Архив"}</span>
      <Link className="iconButton" aria-label="Редактировать карточку" title="Редактировать карточку" to={`/card/${entryId}#edit`} state={{ returnTo }}><Pencil size={17} /></Link>
    </div>
    <div><h2>{word.turkish}</h2><p className="inspectorTranslation">{word.russian}</p><p className="statusMessage">{word.partOfSpeech}</p></div>
    {word.tags.length > 0 && <div className="tagList">{word.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
    {word.exampleTurkish && word.exampleRussian ? <blockquote className="inspectorExample"><p lang="tr">{word.exampleTurkish}</p><p>{word.exampleRussian}</p>
      {word.exampleSourceUrl && <a href={word.exampleSourceUrl} target="_blank" rel="noreferrer">{word.exampleSource || "Источник примера"}<ArrowUpRight size={13} /></a>}
    </blockquote> : <p className="statusMessage">Пример не задан.</p>}
    <dl className="inspectorFacts"><div><dt>Категория</dt><dd>{word.category}</dd></div><div><dt>Повторений</dt><dd>{detail.review.repetitions}</dd></div><div><dt>Следующий повтор</dt><dd>{detail.review.dueAt ? new Date(detail.review.dueAt).toLocaleDateString("ru-RU") : "Не изучено"}</dd></div><div><dt>Источник</dt><dd>{word.sourceName}</dd></div></dl>
    <Link className="secondaryButton fullWidth" to={`/card/${entryId}`} state={{ returnTo }}>Открыть карточку<ArrowUpRight size={16} /></Link>
  </div>;
}
