import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { checkLocalWord, verifyEntry, type EntryPatch, type LocalQuality, type QualityReport } from "../api";

export function LocalWordCheck({ word, entryId }: { word: Pick<EntryPatch, "turkish" | "russian" | "exampleTurkish" | "exampleRussian">; entryId?: number }) {
  const [local, setLocal] = useState<LocalQuality | null>(null);
  const [error, setError] = useState("");
  const { turkish, russian, exampleTurkish, exampleRussian } = word;
  useEffect(() => {
    const controller = new AbortController();
    setLocal(null); setError("");
    if (!turkish?.trim() || !russian?.trim()) return;
    const timer = window.setTimeout(() => {
      checkLocalWord({ turkish, russian, exampleTurkish, exampleRussian }, entryId, controller.signal)
        .then(result => { if (!controller.signal.aborted) setLocal(result); })
        .catch(() => { if (!controller.signal.aborted) setError("Локальная проверка недоступна. Повторите изменение поля."); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [turkish, russian, exampleTurkish, exampleRussian, entryId]);
  return <div className="qualityCheck" aria-live="polite">
    {error && <p className="errorMessage">{error}</p>}
    {local?.warnings.map(warning => <p className="qualityWarning" key={warning}>{warning}</p>)}
    {local && local.matches.length > 0 && <ul className="qualityMatches">{local.matches.map(match => <li key={match.id}>
      <Link to={`/card/${match.id}`}>{match.turkish}</Link> — {match.russian} <small>({match.partOfSpeech})</small>
    </li>)}</ul>}
    {local && !local.warnings.length && <p className="statusMessage">Локальная проверка: совпадений и явных несоответствий не найдено. Точность перевода этим не подтверждена.</p>}
  </div>;
}

const resultLabels: Record<string, string> = {
  matched: "Найдено совпадение слова и значения", differences: "Есть отличия — проверьте значения",
  not_found: "Запись не найдена — перевод не подтверждён", unavailable: "Источник недоступен — проверка не выполнена",
};

export function EntryQualityPanel({ entryId, dirty, disabled, onSuggestion }: {
  entryId: number; dirty: boolean; disabled: boolean;
  onSuggestion: (patch: EntryPatch) => void;
}) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setReport(null); setError(""); }, [entryId, dirty]);
  return <section className="cardSection emptyPanel qualityPanel">
    <h2>Перепроверка перевода</h2>
    <p className="statusMessage">Два интернет-источника: Викисловарь (прямой и обратный поиск по первым трём русским значениям) и официальный турецкий словарь TDK (толкование на турецком). Совпадение подтверждает только найденное значение в конкретном источнике.</p>
    <button type="button" className="secondaryButton" disabled={busy || disabled || dirty} onClick={async () => {
      setBusy(true); setError(""); setReport(null);
      try { setReport(await verifyEntry(entryId)); }
      catch (error) { setError(error instanceof Error ? error.message : "Не удалось выполнить проверку."); }
      finally { setBusy(false); }
    }}>{busy ? "Проверяем…" : "Проверить в интернете и коллекции"}</button>
    {dirty && <p className="statusMessage">Сохраните правки для интернет-проверки. Локальная проверка черновика выполняется в редакторе.</p>}
    {error && <p role="alert" className="errorMessage">{error}</p>}
    {report && <div className="itemList">
      <p className="statusMessage">Проверено: {new Date(report.checkedAt).toLocaleString("ru-RU")}</p>
      {report.local.warnings.map(warning => <p className="qualityWarning" key={warning}>{warning}</p>)}
      {!report.local.matches.length && <p>В личной коллекции совпадений значений не найдено.</p>}
      {report.local.matches.map(match => <p key={match.id}><Link to={`/card/${match.id}`}>{match.turkish}</Link> — {match.russian}</p>)}
      <div className="sourceItem">
        <a href={report.turkishDictionary.sourceUrl} target="_blank" rel="noreferrer">Türk Dil Kurumu — официальный словарь</a>
        {report.turkishDictionary.status === "found" ? <>
          <strong>Толкования на турецком (сопоставьте с переводом)</strong>
          {report.turkishDictionary.definitions.map((text, index) => <p lang="tr" key={index}>{text}</p>)}
        </> : <p>{resultLabels[report.turkishDictionary.status]}</p>}
      </div>
      {report.online.map(result => <div className="sourceItem" key={result.query}>
        <a href={result.sourceUrl} target="_blank" rel="noreferrer">Викисловарь: {result.query}</a>
        <strong>{resultLabels[result.status] ?? result.status}</strong>
        {result.candidates.map((candidate, index) => <div className="qualityCandidate" key={index}>
          <p><a href={candidate.sourceUrl} target="_blank" rel="noreferrer">{candidate.turkish}</a> — {candidate.russian} ({candidate.partOfSpeech})</p>
          <button className="textButton" type="button" disabled={disabled || dirty} onClick={() => onSuggestion({
            turkish: candidate.turkish, russian: candidate.russian, partOfSpeech: candidate.partOfSpeech,
          })}>Перенести в редактор</button>
        </div>)}
      </div>)}
    </div>}
  </section>;
}
