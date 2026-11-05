"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Calculator } from "@/app/_components/calculator";
import { saveDraftAction } from "../../../actions";
import type { ReactNode } from "react";
import type { Budget } from "@/lib/types";

const SAVE_DELAY_MS = 1_000;

type SaveStatus = "saved" | "unsaved" | "saving" | "stale" | "missing" | "error";

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "All changes saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  stale: "This draft changed in another tab. Reload to keep editing.",
  missing: "This draft no longer exists.",
  error: "Changes could not be saved. The next edit will try again.",
};

type DraftEditorProps = { budgetId: string; draftId: string; revision: number; initialBudget: Budget; intro: ReactNode };

export const DraftEditor = ({ budgetId, draftId, revision: initialRevision, initialBudget, intro }: DraftEditorProps) => {
  // Calculator reports its first budget on mount. Comparing against this object skips that call, so a
  // page load does not save and bump the revision.
  const [loaded] = useState(initialBudget);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const revision = useRef(initialRevision);
  const unsaved = useRef<Budget | null>(null);
  const saving = useRef(false);
  const stopped = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // One save runs at a time. Edits made during a save go out after it, with the new revision.
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (saving.current || stopped.current) {
      return;
    }
    saving.current = true;
    while (unsaved.current !== null) {
      const content = unsaved.current;
      unsaved.current = null;
      setStatus("saving");
      const result = await saveDraftAction(budgetId, draftId, revision.current, content).catch(() => ({ status: "error" as const }));
      if (result.status !== "saved") {
        saving.current = false;
        stopped.current = result.status !== "error";
        unsaved.current ??= content;
        setStatus(result.status);
        return;
      }
      revision.current = result.revision;
    }
    saving.current = false;
    setStatus("saved");
  }, [budgetId, draftId]);

  const onBudgetChange = useCallback(
    (budget: Budget) => {
      if (budget === loaded || stopped.current) {
        return;
      }
      unsaved.current = budget;
      setStatus("unsaved");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [loaded, flush],
  );

  // Leaving through a link saves right away. Closing the tab with unsaved edits asks first.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved.current !== null || saving.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
  }, [flush]);

  return (
    <Suspense>
      <Calculator
        initialBudget={loaded}
        onBudgetChange={onBudgetChange}
        intro={intro}
        actions={
          <span role="status" className="text-sm text-[#5b5148]">
            {STATUS_TEXT[status]}
          </span>
        }
      />
    </Suspense>
  );
};
