import { useEffect, useRef } from "react";
import { studyShortcut } from "../studySession";

type StudyActions = {
  onReveal?: () => void;
  onRate?: (correct: boolean) => void;
  onUndo?: () => void;
};

export function useStudyShortcuts(actions: StudyActions) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editing = Boolean(target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], details[open]"));
      const action = studyShortcut(event, editing);
      const { onReveal, onRate, onUndo } = latest.current;
      if (action === "undo" && onUndo) { event.preventDefault(); onUndo(); }
      else if (action === "reveal" && onReveal && !target?.closest("button, a, summary")) {
        event.preventDefault(); onReveal();
      } else if ((action === "correct" || action === "incorrect") && onRate) {
        event.preventDefault(); onRate(action === "correct");
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);
}
