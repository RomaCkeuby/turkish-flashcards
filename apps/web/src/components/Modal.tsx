import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({ title, onClose, busy = false, children, className = "" }: {
  title: string; onClose: () => void; busy?: boolean; children: ReactNode; className?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const isBusy = useRef(busy);
  close.current = onClose;
  isBusy.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy.current) close.current();
      if (event.key !== "Tab") return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ) ?? [])].filter(item => item.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className="modalBackdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div ref={panel} className={`modalPanel ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modalHeader">
          <h2 id={titleId}>{title}</h2>
          <button className="iconButton" title="Закрыть" aria-label="Закрыть" disabled={busy} onClick={onClose} type="button"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>, document.body,
  );
}
