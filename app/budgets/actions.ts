"use server";

import { redirect } from "next/navigation";
import { getDb, requireUser } from "@/app/_server/services";
import { EMPTY_BUDGET, normalizeBudget } from "@/lib/budget";
import { parseBudgetUrl } from "@/lib/serialize";
import { accessBudget, accessDraft, authorOfDraft } from "@/lib/server/access";
import { createDraft, deleteDraft, parseName, saveDraft } from "@/lib/server/store";
import type { SaveResult } from "@/lib/server/store";

export const createDraftAction = async (budgetId: string, form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await accessBudget(db, userId, budgetId);
  const name = parseName(form.get("name"));
  if (access === null || name === null) {
    return;
  }
  redirect(`/budgets/${budgetId}/drafts/${await createDraft(db, access, name, EMPTY_BUDGET)}`);
};

export const deleteDraftAction = async (budgetId: string, draftId: string): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await accessDraft(db, userId, budgetId, draftId);
  if (access !== null) {
    await deleteDraft(db, access);
  }
  redirect(`/budgets/${budgetId}`);
};

export type SaveDraftResult = SaveResult | { status: "missing" };

export const saveDraftAction = async (budgetId: string, draftId: string, revision: number, content: unknown): Promise<SaveDraftResult> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await accessDraft(db, userId, budgetId, draftId);
  const author = access === null ? null : authorOfDraft(access);
  if (author === null || !Number.isInteger(revision)) {
    return { status: "missing" };
  }
  return saveDraft(db, author, revision, normalizeBudget(content));
};

const CALCULATOR_DRAFT_NAME = "From the calculator";

// Takes the `b` param form, which is what the calculator page keeps for later.
export const saveFromCalculatorAction = async (budgetId: string, serialized: string): Promise<string | null> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await accessBudget(db, userId, budgetId);
  const content = parseBudgetUrl(serialized);
  if (access === null || content === null) {
    return null;
  }
  return createDraft(db, access, CALCULATOR_DRAFT_NAME, content);
};
