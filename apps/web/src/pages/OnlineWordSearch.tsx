import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { confirmOnlineWord, fetchEntries, searchOnlineWords, type OnlineWord } from "../api";

export function OnlineWordSearch({ query }: { query: string }) {
  const navigate = useNavigate();
  const [words, setWords] = useState<OnlineWord[]>([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedExamples, setSelectedExamples] = useState<Record<string, string>>({});
  const [resultKind, setResultKind] = useState<"words" | "phrases">("words");
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: number; turkish: string }[]>([]);

  useEffect(() => {
    if (retry === 0) return;
    const controller = new AbortController();
    setStatus("loading");
    setWords([]);
    setExisting([]);
    setMessage("");
    setWarnings([]);
    setSelectedExamples({});
    const timer = window.setTimeout(async () => {
      try {
        // Filters can hide an existing card. Offer it before going to the internet.
        const local = await fetchEntries(query, { limit: 20 }, controller.signal);
        if (controller.signal.aborted) return;
        if (local.total > 0) {
          setExisting(local.entries);
          setStatus("local");
          return;
        }
        const result = await searchOnlineWords(query, controller.signal);
        if (controller.signal.aborted) return;
        setWords(result.candidates);
        setResultKind(result.candidates.some(word => word.sourceName !== "Tatoeba") ? "words" : "phrases");
        setWarnings(result.warnings ?? []);
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Ошибка интернет-поиска.");
      }
    }, 600);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, retry]);

  const add = async (word: OnlineWord) => {
    setAdding(word.id);
    setMessage("");
    try {
      const detail = await confirmOnlineWord(word.id, selectedExamples[word.id] || undefined);
      navigate(`/card/${detail.effective.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось добавить слово.");
    } finally { setAdding(null); }
  };

  const wordCount = words.filter(word => word.sourceName !== "Tatoeba").length;
  const phraseCount = words.length - wordCount;
  const visibleWords = words.filter(word => resultKind === "words" ? word.sourceName !== "Tatoeba" : word.sourceName === "Tatoeba");

  return (
    <section className="onlineWordResults" aria-label="Поиск в интернете" aria-busy={status === "loading"}>
      <h2>Поиск в интернете</h2>
      {status === "idle" && <p className="statusMessage">Можно найти «{query}» в Викисловаре и Tatoeba. Слово попадёт в коллекцию только после вашего выбора.</p>}
      <div role="status">
        {status === "loading" && <p>Ищем в Викисловаре и Tatoeba…</p>}
        {status === "ready" && words.length === 0 && <p>Переводы не найдены. Попробуйте начальную форму слова.</p>}
        {status === "local" && <p>Слова уже есть в словаре, но скрыты выбранными фильтрами.</p>}
        {message && <p className="errorMessage">{message}</p>}
        {warnings.map(warning => <p key={warning}>{warning}</p>)}
      </div>
      {existing.map(word => <Link key={word.id} to={`/card/${word.id}`}>{word.turkish}</Link>)}
      {status !== "loading" && <button className={status === "idle" ? "primaryButton" : "secondaryButton"} disabled={adding !== null} onClick={() => setRetry(value => value + 1)}>{status === "idle" ? "Найти в интернете" : "Повторить интернет-поиск"}</button>}
      {words.length > 0 && <div className="resultTabs" aria-label="Результаты поиска">
        <button type="button" aria-pressed={resultKind === "words"} onClick={() => setResultKind("words")}>Слова ({wordCount})</button>
        <button type="button" aria-pressed={resultKind === "phrases"} onClick={() => setResultKind("phrases")}>Фразы ({phraseCount})</button>
      </div>}
      {words.length > 0 && visibleWords.length === 0 && <p className="statusMessage">В этом разделе результатов нет.</p>}
      {visibleWords.map(word => (
        <article className="onlineWordCandidate" key={word.id}>
          <h3>{word.turkish}</h3>
          <span>{word.partOfSpeech}</span>
          <p>{word.russian}</p>
          {word.sourceName !== "Tatoeba" && word.exampleTurkish && word.exampleRussian ? (
            <blockquote>{word.exampleTurkish}<br /><em>{word.exampleRussian}</em></blockquote>
          ) : word.sourceName !== "Tatoeba" && !word.examples?.length ? <p className="statusMessage">Переводной пример в источниках отсутствует.</p> : null}
          {word.sourceName !== "Tatoeba" && !!word.examples?.length && (
            <details className="usageExamplesDisclosure">
              <summary>{selectedExamples[word.id] ? "Пример выбран" : `Примеры из Tatoeba (${word.examples.length})`}</summary>
            <fieldset className="usageExampleChoices" disabled={adding !== null}>
              <legend>Пример из Tatoeba</legend>
              <label><input type="radio" name={`example-${word.id}`} checked={!selectedExamples[word.id]}
                onChange={() => setSelectedExamples(values => ({ ...values, [word.id]: "" }))} />
                {word.exampleTurkish ? "Оставить словарный пример" : "Без примера"}</label>
              {word.examples.map(example => (
                <div key={example.id}>
                  <label><input type="radio" name={`example-${word.id}`} checked={selectedExamples[word.id] === example.id}
                    onChange={() => setSelectedExamples(values => ({ ...values, [word.id]: example.id }))} />
                    <span>{example.turkish}<br /><em>{example.russian}</em></span></label>
                  <small>{example.authors} · {example.license}</small>
                  <div><a href={example.sourceUrl} target="_blank" rel="noreferrer">Оригинал</a>{" · "}
                    <a href={example.translationSourceUrl} target="_blank" rel="noreferrer">Перевод</a></div>
                </div>
              ))}
            </fieldset>
            </details>
          )}
          {word.sourceName === "Tatoeba" && word.examples?.[0] && <small>
            {word.examples[0].authors} · {word.examples[0].license}{" · "}
            <a href={word.examples[0].translationSourceUrl} target="_blank" rel="noreferrer">Русский перевод</a>
          </small>}
          <a href={word.sourceUrl} target="_blank" rel="noreferrer">{word.sourceName}</a>
          <button className="primaryButton" disabled={adding !== null} onClick={() => add(word)}>
            {adding === word.id ? "Добавляем…" : "Подтвердить добавление"}
          </button>
        </article>
      ))}
    </section>
  );
}
