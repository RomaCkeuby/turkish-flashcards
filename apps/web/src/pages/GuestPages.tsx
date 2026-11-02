import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { Check, RotateCcw, X } from "lucide-react";
import { createGuestDeck, filterGuestEntries, getGuestFilterOptions } from "../guestDeck";
import { DeckStatus, usePublicDeck } from "../publicDeck";
import type { PublicCardEntry } from "../publicDeckTypes";
import { studyShortcut } from "../studySession";
import { NotFoundPage } from "./NotFoundPage";

type Direction = "tr-ru" | "ru-tr";
const cardPath = (entry: PublicCardEntry) => `/card/${encodeURIComponent(entry.key)}`;

function Sources({ entry }: { entry: PublicCardEntry }) {
  return <ul className="guestSources">{entry.sources.map((source, index) => <li key={`${source.purpose}-${index}`}>
    {/^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{source.name || "Источник"}</a> : <span>{source.name || "Источник"}{source.url && ` (${source.url})`}</span>}
    {source.license && <span> · {source.license}</span>}
  </li>)}</ul>;
}

function Example({ entry }: { entry: PublicCardEntry }) {
  return entry.exampleTurkish || entry.exampleRussian ? <div className="cardExample">
    {entry.exampleTurkish && <p lang="tr">{entry.exampleTurkish}</p>}
    {entry.exampleRussian && <p lang="ru">{entry.exampleRussian}</p>}
    <Sources entry={entry} />
  </div> : <Sources entry={entry} />;
}

function GuestDashboard() {
  const { data } = usePublicDeck();
  return <section className="pageStack">
    <header><h1>Свободная тренировка</h1><p className="lead">Базовая подборка доступна независимо от домашнего сервера. Карточки перемешиваются и не повторяются до конца прохода.</p></header>
    {!data ? <DeckStatus /> : <>
      <div className="placeholderGrid" aria-label="Базовая подборка">
        <div className="metric"><span>Слов</span><strong>{data.entries.length}</strong></div>
        <div className="metric"><span>Карточек</span><strong>{data.entries.length * 2}</strong></div>
        <div className="metric"><span>Направления</span><strong>TR / RU</strong></div>
      </div>
      <section className="nextLesson"><div><h2>Выберите направление</h2><p>Ответы относятся только к текущей тренировке и не меняют расписание аккаунта.</p></div>
        <div className="lessonActions"><Link className="primaryLink" to="/study?direction=tr-ru">Турецкий → русский</Link><Link className="secondaryButton" to="/study?direction=ru-tr">Русский → турецкий</Link></div>
      </section>
      <Link to="/dictionary">Посмотреть словарь</Link>
    </>}
  </section>;
}

function GuestFilters({ entries, params, change }: { entries: PublicCardEntry[]; params: URLSearchParams; change: (name: string, value: string) => void }) {
  const options = useMemo(() => getGuestFilterOptions(entries), [entries]);
  return <div className="guestFilters">
    <label className="statusFilter"><span>Категория</span><select value={params.get("category") ?? ""} onChange={e => change("category", e.target.value)}><option value="">Все</option>{options.categories.map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="statusFilter"><span>Часть речи</span><select value={params.get("partOfSpeech") ?? ""} onChange={e => change("partOfSpeech", e.target.value)}><option value="">Все</option>{options.partsOfSpeech.map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="statusFilter"><span>Тег</span><select value={params.get("tag") ?? ""} onChange={e => change("tag", e.target.value)}><option value="">Все</option>{options.tags.map(value => <option key={value}>{value}</option>)}</select></label>
  </div>;
}

function useGuestParams() {
  const [params, setParams] = useSearchParams();
  const change = (name: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(name, value); else next.delete(name);
    if (name !== "page") next.delete("page");
    return next;
  }, { replace: true });
  return { params, change };
}

function GuestDictionary() {
  const { data } = usePublicDeck();
  const { params, change } = useGuestParams();
  const search = params.get("search") ?? "";
  const category = params.get("category") ?? "";
  const partOfSpeech = params.get("partOfSpeech") ?? "";
  const tag = params.get("tag") ?? "";
  const filtered = useMemo(() => data ? filterGuestEntries(data.entries, { search, category, partOfSpeech, tag }) : [], [data, search, category, partOfSpeech, tag]);
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const parsedPage = Number(params.get("page"));
  const page = Math.min(pageCount - 1, Number.isSafeInteger(parsedPage) && parsedPage >= 0 ? parsedPage : 0);
  return <section className="pageStack dictionaryPage"><header><h1>Базовый словарь</h1><p className="lead">Опубликованная подборка. Личные карточки и исправления доступны в серверном режиме.</p></header>
    {!data ? <DeckStatus /> : <>
      <label className="searchField"><span className="srOnly">Поиск по словарю</span><input type="search" placeholder="Найти слово или перевод" value={search} onChange={e => change("search", e.target.value)} /></label>
      <GuestFilters entries={data.entries} params={params} change={change} />
      <p className="resultCount" role="status">Найдено: {filtered.length}</p>
      {filtered.length ? <div className="guestDictionaryList">{filtered.slice(page * pageSize, (page + 1) * pageSize).map(entry => <Link className="guestDictionaryEntry" key={entry.key} to={cardPath(entry)}>
        <strong lang="tr">{entry.turkish}</strong><span lang="ru">{entry.russian}</span><small>{entry.category} · {entry.partOfSpeech}</small>
      </Link>)}</div> : <p className="statusMessage">По выбранным условиям ничего не найдено. Измените поиск или фильтры.</p>}
      {pageCount > 1 && <nav className="paginationBar" aria-label="Страницы словаря"><button className="secondaryButton" disabled={page === 0} onClick={() => change("page", String(page - 1))}>Назад</button><span>{page + 1} / {pageCount}</span><button className="secondaryButton" disabled={page + 1 === pageCount} onClick={() => change("page", String(page + 1))}>Далее</button></nav>}
    </>}
  </section>;
}

function GuestDetail() {
  const { data } = usePublicDeck();
  const { entryId } = useParams();
  const entry = data?.entries.find(item => item.key === entryId);
  return <section className="pageStack"><Link to="/dictionary">← Базовый словарь</Link>
    {!data ? <DeckStatus /> : entry ? <>
      <header><h1 lang="tr">{entry.turkish}</h1><p className="lead" lang="ru">{entry.russian}</p></header>
      <p className="statusMessage">{entry.category} · {entry.partOfSpeech}</p>
      <div className="tagList">{entry.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
      <Example entry={entry} />
      <p className="statusMessage">Редактирование и личное расписание доступны в серверном режиме. Гостевые карточки не изменяют вашу коллекцию.</p>
    </> : <><h1>Карточка не найдена</h1><p className="statusMessage">Эта ссылка не относится к текущей базовой подборке. Выберите карточку в словаре.</p></>}
  </section>;
}

function GuestStudyRound({ entries, direction, category, partOfSpeech, tag, round }: {
  entries: PublicCardEntry[]; direction: Direction; category: string; partOfSpeech: string; tag: string; round: number;
}) {
  const deck = useMemo(() => createGuestDeck(entries, { direction, category, partOfSpeech, tag }), [entries, direction, category, partOfSpeech, tag, round]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const card = deck[index];
  const correct = results.filter(Boolean).length;
  const rate = (isCorrect: boolean) => {
    if (!revealed || !card) return;
    setResults(previous => [...previous, isCorrect]); setIndex(value => value + 1); setRevealed(false);
  };
  const undo = () => {
    if (!index) return;
    setIndex(value => value - 1); setResults(previous => previous.slice(0, -1)); setRevealed(true);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = studyShortcut(event, Boolean(target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], details[open]")));
      if (action === "undo" && index) { event.preventDefault(); undo(); }
      else if (action === "reveal" && card && !revealed && !target?.closest("button, a, summary")) { event.preventDefault(); setRevealed(true); }
      else if ((action === "correct" || action === "incorrect") && revealed && card) { event.preventDefault(); rate(action === "correct"); }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  });
  return <>
    {!card ? <div className="donePanel guestRoundDone"><h2>{deck.length ? "Проход завершён" : "Карточек по этим фильтрам нет"}</h2><p className="statusMessage">{deck.length ? "Можно перемешать колоду и начать новый проход." : "Выберите другую категорию, часть речи или тег."}</p></div> : <div className="studyPreview"><div className="studyCardLayout">
      <div className="cardPromptPane"><p className="cardLabel">{card.entry.category}</p><p className="cardPrompt" lang={direction === "tr-ru" ? "tr" : "ru"}>{direction === "tr-ru" ? card.entry.turkish : card.entry.russian}</p><p className="cardPartOfSpeech">{card.entry.partOfSpeech}</p></div>
      <div className={`cardAnswerPane${revealed ? " isRevealed" : ""}`}>{revealed ? <div className="cardAnswer"><div className="answerHeader"><span>Перевод</span><Link to={cardPath(card.entry)}>Подробнее</Link></div><strong className="answerTranslation">{direction === "tr-ru" ? card.entry.russian : card.entry.turkish}</strong><Example entry={card.entry} /></div> : <p className="answerPlaceholder">Перевод появится после нажатия кнопки</p>}</div>
    </div></div>}
    <div className="queueStrip" aria-label="Текущая тренировка"><div><span>Пройдено</span><strong>{index} / {deck.length}</strong></div><div><span>Верно</span><strong>{correct}</strong></div><div><span>Точность</span><strong>{results.length ? `${Math.round(correct / results.length * 100)}%` : "—"}</strong></div></div>
    <p className="statusMessage">Счётчики только за этот проход. Ответы не записываются в аккаунт.</p>
    <div className="reviewActions">{card && (!revealed ? <button className="primaryButton revealButton" onClick={() => setRevealed(true)}>Показать перевод</button> : <><button className="incorrectButton" onClick={() => rate(false)}><X size={20} />Неверно</button><button className="correctButton" onClick={() => rate(true)}><Check size={20} />Верно</button></>)}</div>
    <button className="textButton" disabled={!index} onClick={undo}>Отменить последнюю оценку в тренировке</button>
    <p className="shortcutHint"><kbd>Пробел</kbd> перевод · <kbd>1</kbd> неверно · <kbd>2</kbd> верно · <kbd>Ctrl/Cmd Z</kbd> отмена</p>
  </>;
}

function GuestStudy() {
  const { data } = usePublicDeck();
  const { params, change } = useGuestParams();
  const [round, setRound] = useState(0);
  const direction: Direction = params.get("direction") === "ru-tr" ? "ru-tr" : "tr-ru";
  const category = params.get("category") ?? "";
  const partOfSpeech = params.get("partOfSpeech") ?? "";
  const tag = params.get("tag") ?? "";
  const roundKey = JSON.stringify([direction, category, partOfSpeech, tag, round]);
  return <section className="pageStack guestStudy"><header><h1>Свободная тренировка</h1><p className="lead">Перемешанная колода · {direction === "tr-ru" ? "TR → RU" : "RU → TR"}</p></header>
    <div className="studyControls"><div className="segmentedControl" aria-label="Направление перевода"><button aria-pressed={direction === "tr-ru"} onClick={() => change("direction", "tr-ru")}>TR → RU</button><button aria-pressed={direction === "ru-tr"} onClick={() => change("direction", "ru-tr")}>RU → TR</button></div><button className="secondaryButton" onClick={() => setRound(value => value + 1)}><RotateCcw size={16} />Новый проход</button></div>
    {!data ? <DeckStatus /> : <><GuestFilters entries={data.entries} params={params} change={change} /><GuestStudyRound key={roundKey} entries={data.entries} direction={direction} category={category} partOfSpeech={partOfSpeech} tag={tag} round={round} /></>}
  </section>;
}

function GuestSettings() {
  const { data } = usePublicDeck();
  return <section className="pageStack"><header><h1>Настройки</h1><p className="lead">Сейчас открыт гостевой режим с опубликованной подборкой.</p></header>
    {!data ? <DeckStatus /> : <div className="emptyPanel settingsDetails"><div><span>Подборка</span><strong>{data.manifest.version}</strong></div><div><span>Слов</span><strong>{data.entries.length}</strong></div><div><span>Прогресс аккаунта</span><strong>Не изменяется</strong></div></div>}
    <section className="emptyPanel"><h2>Серверный режим</h2><p>Для работы с личной коллекцией и расписанием выберите «Сервер на ПК» над страницей. Домашний сервер должен быть доступен.</p><p className="statusMessage">Подключение удалённого аккаунта появится на следующем этапе. В этой версии серверный режим использует существующий API приложения.</p></section>
    <p className="statusMessage">Для первой загрузки подборки нужен интернет. Сохранение сайта для занятий без интернета будет добавлено отдельно.</p>
  </section>;
}

export function GuestRoutes() {
  return <Routes><Route path="/" element={<GuestDashboard />} /><Route path="/study" element={<GuestStudy />} /><Route path="/dictionary" element={<GuestDictionary />} /><Route path="/card/:entryId" element={<GuestDetail />} /><Route path="/settings" element={<GuestSettings />} /><Route path="*" element={<NotFoundPage />} /></Routes>;
}
