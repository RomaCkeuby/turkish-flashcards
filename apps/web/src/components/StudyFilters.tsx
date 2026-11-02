import { useEffect, useRef, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

export function StudyFilters({ count, children }: { count: number; children: ReactNode }) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const fitPanel = () => {
      const panel = disclosure.current?.querySelector<HTMLElement>(".studyFilters");
      if (!panel || !disclosure.current?.open) return;
      const navigation = document.querySelector<HTMLElement>(".navList");
      const bottom = navigation && getComputedStyle(navigation).position === "fixed"
        ? navigation.getBoundingClientRect().top : window.innerHeight;
      panel.style.maxHeight = `${Math.max(0, bottom - panel.getBoundingClientRect().top - 12)}px`;
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target))
        disclosure.current?.removeAttribute("open");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && disclosure.current?.open) {
        disclosure.current.open = false;
        disclosure.current.querySelector("summary")?.focus();
      }
    };
    const closeOnFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && !disclosure.current?.contains(event.relatedTarget))
        disclosure.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    const element = disclosure.current;
    element?.addEventListener("toggle", fitPanel);
    window.addEventListener("resize", fitPanel);
    window.visualViewport?.addEventListener("resize", fitPanel);
    element?.addEventListener("focusout", closeOnFocusOut);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      element?.removeEventListener("focusout", closeOnFocusOut);
      element?.removeEventListener("toggle", fitPanel);
      window.removeEventListener("resize", fitPanel);
      window.visualViewport?.removeEventListener("resize", fitPanel);
    };
  }, []);
  return <details ref={disclosure} className="filterDisclosure studyFilterDisclosure">
    <summary><SlidersHorizontal size={17} />Фильтры{count > 0 && <span className="filterCount">{count}</span>}</summary>
    <div className="studyFilters">
      {children}
      <button className="secondaryButton filterDoneButton" type="button" onClick={() => {
        if (disclosure.current) disclosure.current.open = false;
        disclosure.current?.querySelector("summary")?.focus();
      }}>Готово</button>
    </div>
  </details>;
}
