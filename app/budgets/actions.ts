"use server";

import { redirect } from "next/navigation";
import { getDb, requireUser, withTransactions } from "@/app/_server/services";
import { EMPTY_BUDGET, normalizeBudget } from "@/lib/budget";
import { parseBudgetUrl } from "@/lib/serialize";
import { accessBudget, accessDraft, authorOfDraft } from "@/lib/server/access";
import {
  createDraft,
  createDraftFromVersion,
  deleteDraft,
  parseName,
  parseNote,
  parseVersionNumber,
  publishDraft,
  saveDraft,
} from "@/lib/server/store";
import type { PublishResult, SaveResult } from "@/lib/server/store";

// An empty `from` starts an empty draft. A version number starts from that version, which is how a restore begins.
export const createDraftAction = async (budgetId: string, form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await accessBudget(db, userId, budgetId);
  const name = parseName(form.get("name"));
  const from = form.get("from") ?? "";
  const number = parseVersionNumber(from);
  if (access === null || name === null || (from !== "" && number === null)) {
    return;
  }
  const draftId =
    number === null ? await createDraft(db, access, name, EMPTY_BUDGET) : await createDraftFromVersion(db, access, name, number);
  if (draftId !== null) {
    redirect(`/budgets/${budgetId}/drafts/${draftId}`);
  }
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

export type PublishDraftResult = PublishResult | { status: "invalid" };

export const publishDraftAction = async (
  budgetId: string,
  draftId: string,
  revision: number,
  note: string,
  confirmedLatest: number,
): Promise<PublishDraftResult> => {
  const { id: userId } = await requireUser();
  const access = await accessDraft(getDb(), userId, budgetId, draftId);
  const parsedNote = parseNote(note);
  if (access === null) {
    return { status: "missing" };
  }
  if (parsedNote === null || !Number.isInteger(revision) || !Number.isInteger(confirmedLatest)) {
    return { status: "invalid" };
  }
  // Until sharing ships, only the building admin reaches a draft, and the admin may publish any draft.
  return withTransactions((db) => publishDraft(db, access, { revision, note: parsedNote, confirmedLatest }));
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
