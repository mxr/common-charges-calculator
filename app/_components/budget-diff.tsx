import { isUnchanged } from "@/lib/diff";
import { formatCurrency } from "@/lib/format";
import type { BudgetDiff, EntryChange } from "@/lib/diff";

const CHANGE_TEXT: Record<EntryChange["change"], string> = { added: "Added", removed: "Removed", changed: "Changed" };

const formatCharge = (value: number | null) => (value === null ? "none" : `${formatCurrency(value)}/mo`);

// Lists what changed between two budgets, then how each unit's monthly charge moves.
export const BudgetDiffView = ({ diff }: { diff: BudgetDiff }) => {
  if (isUnchanged(diff)) {
    return <p className="text-sm text-[#5b5148]">No changes.</p>;
  }
  return (
    <div className="flex flex-col gap-4 text-sm">
      {diff.sections.map(({ section, entries }) => (
        <div key={section} className="flex flex-col gap-1">
          <h4 className="font-semibold">{section}</h4>
          <ul className="flex flex-col gap-1">
            {entries.map((entry, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two entries can share a name, and the list never reorders
              <li key={index}>
                {CHANGE_TEXT[entry.change]} {entry.name}
                {entry.change === "changed" ? (
                  <ul className="pl-4 text-[#5b5148]">
                    {entry.fields.map(({ field, before, after }) => (
                      <li key={field}>
                        {field}: {before || "(empty)"} → {after || "(empty)"}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {diff.charges.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="font-semibold">Monthly charges</h4>
          <ul className="flex flex-col gap-1">
            {diff.charges.map(({ unit, before, after }, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two units can share a label, and the list never reorders
              <li key={index}>
                {unit}: {formatCharge(before)} → {formatCharge(after)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
