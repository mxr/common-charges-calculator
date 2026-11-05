"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { saveFromCalculatorAction } from "@/app/budgets/actions";
import { clearPendingBudget, readPendingBudget } from "./save-to-account";
import { BUTTON_CLASS, LINK_CLASS } from "./styles";

// Finishes "Save to account" from the calculator. With a budget it saves there; without one it says where to go.
export const PendingSave = ({ budgetId }: { budgetId?: string }) => {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => setPending(readPendingBudget()), []);

  if (pending === null) {
    return null;
  }

  const discard = () => {
    clearPendingBudget();
    setPending(null);
  };

  const save = async (id: string) => {
    setSaving(true);
    const draftId = await saveFromCalculatorAction(id, pending);
    setSaving(false);
    if (draftId === null) {
      setError(true);
      return;
    }
    clearPendingBudget();
    router.push(`/budgets/${id}/drafts/${draftId}`);
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[#eccfa3] bg-[#fff6e6] p-4 text-sm text-[#7a5a23]">
      <p>
        {budgetId === undefined
          ? "You have a budget from the calculator to save. Open a budget, or create one, to save it as a draft."
          : "You have a budget from the calculator to save."}
      </p>
      {error ? <p role="alert">The budget could not be saved. Try again.</p> : null}
      <div className="flex items-center gap-4">
        {budgetId === undefined ? null : (
          <button type="button" disabled={saving} className={BUTTON_CLASS} onClick={() => save(budgetId)}>
            Save it here as a new draft
          </button>
        )}
        <button type="button" className={LINK_CLASS} onClick={discard}>
          Discard it
        </button>
      </div>
    </section>
  );
};
