import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadPublicDeck } from "./publicDeckData";
import type { PublicCardEntry, PublicDeckManifest } from "./publicDeckTypes";

type DeckData = { entries: PublicCardEntry[]; manifest: PublicDeckManifest };
type DeckState = { data: DeckData | null; error: string; retry: () => void };
const DeckContext = createContext<DeckState | null>(null);
let cached: Promise<DeckData> | undefined;

export function PublicDeckProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    cached ??= loadPublicDeck(import.meta.env.BASE_URL).catch(error => { cached = undefined; throw error; });
    cached.then(value => { if (active) setData(value); }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Не удалось прочитать подборку.");
    });
    return () => { active = false; };
  }, [attempt]);
  return <DeckContext.Provider value={{ data, error, retry: () => setAttempt(value => value + 1) }}>{children}</DeckContext.Provider>;
}

export function usePublicDeck() {
  const context = useContext(DeckContext);
  if (!context) throw new Error("Не подключён источник публичной подборки.");
  return context;
}

export function DeckStatus() {
  const { error, retry } = usePublicDeck();
  return error ? <div className="emptyPanel"><p className="errorMessage" role="alert">{error}</p><button className="secondaryButton" onClick={retry}>Повторить загрузку</button></div>
    : <p className="statusMessage" role="status">Загружаем базовую подборку…</p>;
}
