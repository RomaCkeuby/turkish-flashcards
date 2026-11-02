import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteEntry, fetchEntries, fetchEntryDetail, mergeEntries, type DictionaryEntry, type EntryDetail } from "../api";
import { Modal } from "./Modal";

export function EntryManagement({ detail, disabled, dirty, onChange }: {
  detail: EntryDetail; disabled: boolean; dirty: boolean; onChange: (detail: EntryDetail) => void;
}) {
  const navigate = useNavigate();
  const [action, setAction] = useState<"delete" | "merge" | null>(null);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [target, setTarget] = useState<EntryDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setEntries([]);
    if (action !== "merge") return;
    const timer = window.setTimeout(() => {
      fetchEntries(query, { limit: 20 }, controller.signal).then(data => {
        if (!controller.signal.aborted) setEntries(data.entries.filter(entry => entry.id !== detail.effective.id));
      }).catch(() => { if (!controller.signal.aborted) setError("Не удалось найти карточки."); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, action, detail.effective.id]);
  return <section className="cardSection emptyPanel">
    <h2>Удаление и слияние</h2>
    <p className="statusMessage">Удалённое слово исчезнет из словаря и занятий, его можно восстановить по ссылке на карточку. Обновления не вернут его автоматически.</p>
    {dirty && <p className="qualityWarning">Сначала сохраните или сбросьте правки.</p>}
    <div className="updateActions">
      <button className="secondaryButton" type="button" disabled={disabled || dirty} onClick={() => { setAction("merge"); setQuery(detail.effective.russian.split(/[;,]/)[0] ?? ""); setTarget(null); setError(""); }}>Объединить с другой карточкой</button>
      <button className="secondaryButton dangerButton" type="button" disabled={disabled || dirty} onClick={() => { setAction("delete"); setError(""); }}>Удалить карточку</button>
    </div>
    {action && <Modal title={action === "delete" ? "Удалить карточку?" : "Слияние карточек"} busy={busy} onClose={() => setAction(null)}>
      {action === "delete" ? <>
        <p><strong>{detail.effective.turkish}</strong> — {detail.effective.russian}</p>
        <p>Оба учебных направления будут скрыты. Данные и прогресс сохранятся для восстановления.</p>
        <button className="primaryButton dangerButton" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { onChange(await deleteEntry(detail.effective.id)); setAction(null); }
          catch (error) { setError(error instanceof Error ? error.message : "Не удалось удалить карточку."); }
          finally { setBusy(false); }
        }}>Подтвердить удаление</button>
      </> : <div className="quickCreateForm">
        <p>Исходная карточка: <strong>{detail.effective.turkish}</strong> — {detail.effective.russian}</p>
        <label><span>Найдите итоговую карточку</span><input value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setTarget(null); setError(""); }} /></label>
        <div className="itemList">{entries.map(entry => <button type="button" className="secondaryButton" key={entry.id} disabled={busy} onClick={async () => {
          setBusy(true); setError(""); setTarget(null);
          try { setTarget(await fetchEntryDetail(entry.id)); }
          catch { setError("Не удалось загрузить итоговую карточку."); }
          finally { setBusy(false); }
        }}>{entry.turkish} — {entry.russian}</button>)}{!entries.length && <p className="statusMessage">Подходящих карточек нет.</p>}</div>
        {target && <div className="qualityPreview">
          <h3>Итоговая карточка: {target.effective.turkish}</h3><p>{target.effective.russian}</p>
          <p>Её слово, основной перевод, часть речи и основной пример сохранятся. Переводы и примеры исходной карточки добавятся как дополнительные, теги объединятся. История ответов перенесётся; для каждого направления сохранится ближайший срок повторения и меньший интервал.</p>
          <p>Исходная карточка исчезнет из словаря и занятий. Автоматической отмены слияния нет; исходные данные сохранятся в истории.</p>
          <button className="primaryButton" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try { const result = await mergeEntries(detail, target); setAction(null); navigate(`/card/${result.effective.id}`, { replace: true }); }
            catch (error) { setTarget(null); setError(error instanceof Error ? error.message : "Не удалось объединить карточки."); }
            finally { setBusy(false); }
          }}>Объединить в «{target.effective.turkish}»</button>
        </div>}
      </div>}
      {error && <p className="errorMessage" role="alert">{error}</p>}
    </Modal>}
  </section>;
}
