"use client";

import { useState } from "react";
import { deleteDraftAction } from "../actions";

// A deleted draft cannot be restored, so the first click only asks for a second one.
export const DeleteDraftButton = ({ budgetId, draftId }: { budgetId: string; draftId: string }) => {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <form action={deleteDraftAction.bind(null, budgetId, draftId)} className="flex gap-3">
      <button type="submit" className="text-red-700 underline">
        Delete for good
      </button>
      <button type="button" className="underline" onClick={() => setConfirming(false)}>
        Keep
      </button>
    </form>
  ) : (
    <button type="button" className="text-red-700 underline" onClick={() => setConfirming(true)}>
      Delete
    </button>
  );
};
