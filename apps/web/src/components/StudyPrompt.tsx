import type { ReactNode } from "react";
import { useStudyFit } from "./useStudyFit";

export function StudyPrompt({ children }: { children: ReactNode }) {
  const prompt = useStudyFit(children, "--prompt-scale");
  return <div ref={prompt} className="cardPromptPane">{children}</div>;
}
