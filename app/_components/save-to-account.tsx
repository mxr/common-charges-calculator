"use client";

import { pillButton } from "./calculator";

// Holds the `b` param of the budget being saved. Login cannot carry a return URL, so the budget waits here.
export const PENDING_BUDGET_KEY = "pendingBudget";

export const readPendingBudget = (): string | null => {
  try {
    return window.localStorage.getItem(PENDING_BUDGET_KEY);
  } catch {
    return null;
  }
};

export const clearPendingBudget = () => {
  try {
    window.localStorage.removeItem(PENDING_BUDGET_KEY);
  } catch {}
};

const saveToAccount = () => {
  const serialized = new URLSearchParams(window.location.search).get("b");
  try {
    if (serialized) {
      window.localStorage.setItem(PENDING_BUDGET_KEY, serialized);
    }
  } catch {}
  window.location.assign("/buildings");
};

export const SaveToAccountButton = () => (
  <button type="button" className={pillButton} onClick={saveToAccount}>
    Save to account
  </button>
);
