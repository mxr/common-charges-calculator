"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BudgetDiffView } from "@/app/_components/budget-diff";
import { BUTTON_CLASS, INPUT_CLASS } from "@/app/_components/styles";
import { publishDraftAction } from "../actions";
import type { BudgetDiff } from "@/lib/diff";

const PROBLEM_TEXT = {
  unsaved: "Your changes could not be saved, so the draft was not published. Try again.",
  stale: "This draft changed since the page loaded. Reload, then publish.",
  missing: "This draft no longer exists.",
  invalid: "The note is too long.",
  error: "The draft could not be published. Try again.",
} as const;

type Problem = keyof typeof PROBLEM_TEXT;

type PublishButtonProps = {
  budgetId: string;
  draftId: string;
  // The revision the page loaded. The editor passes `beforePublish` instead, which saves first and returns the
  // revision it saved, or null if the save failed.
  revision: number;
  beforePublish?: () => Promise<number | null>;
};

export const PublishButton = ({ budgetId, draftId, revision, beforePublish }: PublishButtonProps) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // Set when another version was published after this draft started. Publishing then needs a second click.
  const [behind, setBehind] = useState<{ latest: number; changes: BudgetDiff } | null>(null);

  const publish = async () => {
    setPending(true);
    setProblem(null);
    const saved = beforePublish === undefined ? revision : await beforePublish();
    if (saved === null) {
      setPending(false);
      setProblem("unsaved");
      return;
    }
    const result = await publishDraftAction(budgetId, draftId, saved, note, behind?.latest ?? 0).catch(() => ({
      status: "error" as const,
    }));
    if (result.status === "published") {
      router.push(`/budgets/${budgetId}/versions/${result.number}`);
      return;
    }
    setPending(false);
    if (result.status === "behind") {
      setBehind({ latest: result.latest, changes: result.changes });
    } else {
      setProblem(result.status);
    }
  };

  const cancel = () => {
    setOpen(false);
    setBehind(null);
    setProblem(null);
  };

  if (!open) {
    return (
      <button type="button" className="underline" onClick={() => setOpen(true)}>
        Publish
      </button>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-2xl border border-[#e7d7c8] bg-white p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void publish();
      }}
    >
      <label className="flex flex-col gap-1">
        Note for the changelog (optional)
        <textarea
          name="note"
          maxLength={2000}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      {behind === null ? null : (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-[#eccfa3] bg-[#fff6e6] p-3 text-[#7a5a23]">
          <p>
            Version {behind.latest} was published after this draft started. Publishing replaces it with this draft. Changes from version{" "}
            {behind.latest}:
          </p>
          <BudgetDiffView diff={behind.changes} />
        </div>
      )}
      {problem === null ? null : <p role="alert">{PROBLEM_TEXT[problem]}</p>}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className={BUTTON_CLASS}>
          {behind === null ? "Publish version" : "Publish anyway"}
        </button>
        <button type="button" className="underline" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};
