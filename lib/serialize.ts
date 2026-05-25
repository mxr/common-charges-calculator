import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { normalizeBudget } from "./budget";
import type { Budget } from "./types";

// Compact, URL-safe encoding for the `?b=` param.
export const serializeBudgetUrl = (budget: Budget): string => compressToEncodedURIComponent(JSON.stringify(budget));

export const parseBudgetUrl = (value: string | null): Budget | null => {
  if (!value) {
    return null;
  }
  try {
    const json = decompressFromEncodedURIComponent(value);
    if (!json) {
      return null;
    }
    return normalizeBudget(JSON.parse(json));
  } catch {
    return null;
  }
};

// Human-readable form for file download.
export const exportBudgetJson = (budget: Budget): string => JSON.stringify(budget, null, 2);

export const parseBudgetJson = (text: string): Budget | null => {
  try {
    return normalizeBudget(JSON.parse(text));
  } catch {
    return null;
  }
};
