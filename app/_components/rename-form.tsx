"use client";

import { useState } from "react";
import { BUTTON_CLASS, INPUT_CLASS } from "./styles";

// Give it `key={name}`, so a saved rename closes the form.
export const RenameForm = ({ action, name, label }: { action: (form: FormData) => Promise<void>; name: string; label: string }) => {
  const [open, setOpen] = useState(false);
  return open ? (
    <form action={action} className="flex w-full flex-wrap items-end gap-3">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        {label}
        <input name="name" required maxLength={200} defaultValue={name} className={INPUT_CLASS} />
      </label>
      <button type="submit" className={BUTTON_CLASS}>
        Save
      </button>
      <button type="button" className="text-sm underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  ) : (
    <button type="button" className="text-sm underline" onClick={() => setOpen(true)}>
      Rename
    </button>
  );
};
