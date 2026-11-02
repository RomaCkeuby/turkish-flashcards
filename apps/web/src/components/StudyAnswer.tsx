import type { ReactNode } from "react";
import { useStudyFit } from "./useStudyFit";

export function StudyAnswer({ children }: { children: ReactNode }) {
  const answer = useStudyFit(children, "--answer-scale");
  return <div ref={answer} className="cardAnswer">{children}</div>;
}
