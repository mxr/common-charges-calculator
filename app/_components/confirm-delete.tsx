"use client";

import { useState } from "react";
import { INPUT_CLASS } from "./styles";
import type { DeleteImpact } from "@/lib/server/store";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

type ConfirmDeleteProps = {
  action: (form: FormData) => Promise<void>;
  name: string;
  what: "building" | "project" | "budget";
  impact: DeleteImpact;
};

// A delete cannot be undone, so it shows what goes with it and waits for the exact name. The server checks the name too.
export const ConfirmDelete = ({ action, name, what, impact }: ConfirmDeleteProps) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!open) {
    return (
      <button type="button" className="text-sm text-red-700 underline" onClick={() => setOpen(true)}>
        Delete {what}
      </button>
    );
  }
  const removed = [
    ...(what === "budget" ? [] : [count(impact.budgets, "budget")]),
    count(impact.versions, "published version"),
    count(impact.drafts, "draft"),
  ];
  return (
    <form action={action} className="flex w-full flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p>
        Deleting {name} also deletes {new Intl.ListFormat("en-US").format(removed)}. This cannot be undone.
      </p>
      {impact.members.length === 0 ? (
        <p>No members lose access.</p>
      ) : (
        <div>
          <p>These members lose access:</p>
          <ul className="list-disc pl-5">
            {impact.members.map((member) => (
              <li key={member.userId}>{member.email ?? "A deleted account"}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span>
          Type <strong>{name}</strong> to confirm.
        </span>
        <input name="confirm" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" className={INPUT_CLASS} />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={typed.trim() !== name}
          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Delete for good
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Keep
        </button>
      </div>
    </form>
  );
};
