"use client";

import { useState } from "react";
import { BUTTON_CLASS, INPUT_CLASS } from "@/app/_components/styles";
import { createInviteAction } from "../actions";
import type { FormEvent } from "react";

// Only a hash of the token is stored, so the link is shown here once.
export const CreateInvite = ({ budgetId }: { budgetId: string }) => {
  const [role, setRole] = useState("viewer");
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const token = await createInviteAction(budgetId, role).catch(() => null);
    setPending(false);
    setError(token === null);
    setLink(token === null ? null : `${window.location.origin}/invites/${token}`);
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          New invite link
          <select name="role" value={role} onChange={(event) => setRole(event.target.value)} className={INPUT_CLASS}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={BUTTON_CLASS}>
          Create link
        </button>
      </form>
      {error ? <p role="alert">The link could not be created. Try again.</p> : null}
      {link === null ? null : (
        <div className="flex flex-col gap-1 rounded-xl border border-[#eccfa3] bg-[#fff6e6] p-3 text-[#7a5a23]">
          <p>Copy this link now. It is shown only once, works for one person, and expires in 7 days.</p>
          <input readOnly value={link} aria-label="Invite link" onFocus={(event) => event.target.select()} className={INPUT_CLASS} />
        </div>
      )}
    </div>
  );
};
