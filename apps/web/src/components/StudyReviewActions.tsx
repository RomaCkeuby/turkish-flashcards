import { Check, Undo2, X } from "lucide-react";

export function StudyReviewActions({ revealed, ready, busy = false, canUndo, onReveal, onRate, onUndo }: {
  revealed: boolean; ready: boolean; busy?: boolean; canUndo: boolean;
  onReveal: () => void; onRate: (correct: boolean) => void; onUndo: () => void;
}) {
  return <div className="reviewActions" aria-label="Оценка ответа">
    {!revealed ? <button className="primaryButton revealButton" disabled={!ready || busy} onClick={onReveal} type="button">Показать перевод</button> : <>
      <button className="incorrectButton" disabled={!ready || busy} onClick={() => onRate(false)} type="button"><X size={20} />Неверно</button>
      <button className="correctButton" disabled={!ready || busy} onClick={() => onRate(true)} type="button"><Check size={20} />Верно</button>
    </>}
    <button className="secondaryButton undoReviewButton" aria-label="Отменить последнюю оценку" title="Отменить последнюю оценку (Ctrl/Cmd + Z)" disabled={!canUndo || busy} onClick={onUndo} type="button"><Undo2 size={17} /></button>
  </div>;
}
