import { useLayoutEffect, useRef, type ReactNode } from "react";

export function useStudyFit(children: ReactNode, property: string) {
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    let active = true;
    const fit = () => {
      if (!active) return;
      element.style.setProperty(property, "1");
      const fits = () => element.scrollHeight <= element.clientHeight + 1
        && element.scrollWidth <= element.clientWidth + 1;
      if (fits()) return;
      let lower = 0.5;
      let upper = 1;
      for (let step = 0; step < 8; step++) {
        const scale = (lower + upper) / 2;
        element.style.setProperty(property, String(scale));
        if (fits()) lower = scale; else upper = scale;
      }
      element.style.setProperty(property, String(lower));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    document.fonts.ready.then(fit);
    return () => { active = false; observer.disconnect(); };
  }, [children, property]);
  return content;
}
