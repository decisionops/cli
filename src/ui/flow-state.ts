import type { PromptChrome } from "./prompts.js";

let promptCount = 0;

export function resetFlowState(): void {
  promptCount = 0;
}

export function flowChrome(chrome?: PromptChrome): PromptChrome {
  const isFirst = promptCount === 0;
  promptCount++;
  return {
    ...chrome,
    showBrandHeader: isFirst,
  };
}
