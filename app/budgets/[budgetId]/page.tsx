import Link from "next/link";
import { notFound } from "next/navigation";
import { PendingSave } from "@/app/_components/pending-save";
import { BUTTON_CLASS, INPUT_CLASS, LINK_CLASS } from "@/app/_components/styles";
import { getDb, requireUser } from "@/app/_server/services";
import { accessBudget } from "@/lib/server/access";
import { getBudget } from "@/lib/server/store";
import { createDraftAction } from "../actions";
import { DeleteDraftButton } from "./delete-draft-button";

export const dynamic = "force-dynamic";

const formatUpdated = (date: Date) => date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function BudgetPage({ params }: { params: Promise<{ budgetId: string }> }) {
  const { budgetId } = await params;
  const user = await requireUser();
  const db = getDb();
  const access = await accessBudget(db, user.id, budgetId);
  if (access === null) {
    notFound();
  }
  const budget = await getBudget(db, access);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <nav className="flex gap-2 text-sm text-[#5b5148]">
        <Link href="/buildings" className={LINK_CLASS}>
          Buildings
        </Link>
        <span>/</span>
        <Link href={`/buildings/${budget.building.id}`} className={LINK_CLASS}>
          {budget.building.name}
        </Link>
        <span>/</span>
        <span>{budget.project.name}</span>
      </nav>
      <h1 className="text-2xl font-semibold">{budget.name}</h1>
      <PendingSave budgetId={budgetId} />
      <h2 className="text-lg font-semibold">Drafts</h2>
      {budget.drafts.length === 0 ? (
        <p className="text-sm text-[#5b5148]">No drafts.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {budget.drafts.map((draft) => (
            <li key={draft.id} className="flex items-center gap-4">
              <Link href={`/budgets/${budgetId}/drafts/${draft.id}`} className={LINK_CLASS}>
                {draft.name}
              </Link>
              <span className="text-[#5b5148]">Saved {formatUpdated(draft.updatedAt)} UTC</span>
              <DeleteDraftButton budgetId={budgetId} draftId={draft.id} />
            </li>
          ))}
        </ul>
      )}
      <form action={createDraftAction.bind(null, budgetId)} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          New empty draft
          <input name="name" required maxLength={200} placeholder="New roof" className={INPUT_CLASS} />
        </label>
        <button type="submit" className={BUTTON_CLASS}>
          Create
        </button>
      </form>
    </main>
  );
}
