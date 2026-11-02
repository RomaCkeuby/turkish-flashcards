import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRemovedEntries, restoreEntry, type DictionaryEntry, type EntryDetail } from "../api";

export function RemovedEntries({ onChange }: { onChange: () => void }) {
  const [entries, setEntries] = useState<(DictionaryEntry & { removal: EntryDetail["removal"] })[]>([]);
  const [message, setMessage] = useState("Загружаем…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchRemovedEntries(controller.signal).then(data => { if (!controller.signal.aborted) { setEntries(data); setMessage(""); } })
      .catch(() => { if (!controller.signal.aborted) setMessage("Не удалось загрузить удалённые карточки."); });
    return () => controller.abort();
  }, []);
  return <div className="itemList">
    <p role="status">{message || (!entries.length ? "Удалённых карточек нет." : "")}</p>
    {entries.map(entry => <div className="sourceItem" key={entry.id}>
      <Link to={`/card/${entry.id}`}>{entry.turkish} — {entry.russian}</Link>
      {entry.removal?.kind === "merged" ? <Link to={`/card/${entry.removal.targetId}`}>Объединена: открыть итоговую карточку</Link> :
        <button className="secondaryButton" disabled={busy} onClick={async () => {
          setBusy(true); setMessage("");
          try { await restoreEntry(entry.id); setEntries(current => current.filter(item => item.id !== entry.id)); onChange(); }
          catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось восстановить карточку."); }
          finally { setBusy(false); }
        }}>Восстановить</button>}
    </div>)}
  </div>;
}
