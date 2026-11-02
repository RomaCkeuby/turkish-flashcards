import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const StudyStatsHost = createContext<HTMLDivElement | null>(null);

export function StudyStats({ children }: { children: ReactNode }) {
  const host = useContext(StudyStatsHost);
  return host ? createPortal(children, host) : null;
}
