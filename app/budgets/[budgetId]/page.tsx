import Link from "next/link";
import { notFound } from "next/navigation";
import { BudgetDiffView } from "@/app/_components/budget-diff";
import { PendingSave } from "@/app/_components/pending-save";
import { BUTTON_CLASS, INPUT_CLASS, LINK_CLASS } from "@/app/_components/styles";
import { getDb, requireUser } from "@/app/_server/services";
import { accessBudget } from "@/lib/server/access";
import { getBudget, getChangelog } from "@/lib/server/store";
import { createDraftAction } from "../actions";
import { DeleteDraftButton } from "./delete-draft-button";
import { PublishButton } from "./publish-button";

export const dynamic = "force-dynamic";

const formatDate = (date: Date) => date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function BudgetPage({ params }: { params: Promise<{ budgetId: string }> }) {
  const { budgetId } = await params;
  const user = await requireUser();
  const db = getDb();
  const access = await accessBudget(db, user.id, budgetId);
  if (access === null) {
    notFound();
  }
  const [budget, changelog] = await Promise.all([getBudget(db, access), getChangelog(db, access)]);

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
      <p className="text-sm">
        {budget.latestVersion === 0 ? (
          "Nothing is published yet. Publish a draft to make version 1."
        ) : (
          <Link href={`/budgets/${budgetId}/versions/${budget.latestVersion}`} className={LINK_CLASS}>
            View the latest version, version {budget.latestVersion}
          </Link>
        )}
      </p>
      <h2 className="text-lg font-semibold">Drafts</h2>
      {budget.drafts.length === 0 ? (
        <p className="text-sm text-[#5b5148]">No drafts.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {budget.drafts.map((draft) => (
            <li key={draft.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link href={`/budgets/${budgetId}/drafts/${draft.id}`} className={LINK_CLASS}>
                {draft.name}
              </Link>
              <span className="text-[#5b5148]">
                {draft.baseVersion === 0 ? "Not from a version" : `From version ${draft.baseVersion}`}, saved {formatDate(draft.updatedAt)}{" "}
                UTC
              </span>
              <PublishButton budgetId={budgetId} draftId={draft.id} revision={draft.revision} />
              <DeleteDraftButton budgetId={budgetId} draftId={draft.id} />
            </li>
          ))}
        </ul>
      )}
      <form action={createDraftAction.bind(null, budgetId)} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          New draft
          <input name="name" required maxLength={200} placeholder="New roof" className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Start from
          <select name="from" defaultValue={budget.latestVersion === 0 ? "" : String(budget.latestVersion)} className={INPUT_CLASS}>
            {changelog.map((version) => (
              <option key={version.number} value={version.number}>
                Version {version.number}
                {version.number === budget.latestVersion ? " (latest)" : ""}
              </option>
            ))}
            <option value="">An empty budget</option>
          </select>
        </label>
        <button type="submit" className={BUTTON_CLASS}>
          Create
        </button>
      </form>
      <h2 className="text-lg font-semibold">Changelog</h2>
      {changelog.length === 0 ? (
        <p className="text-sm text-[#5b5148]">No versions yet.</p>
      ) : (
        <ol className="flex flex-col gap-4 text-sm">
          {changelog.map((version) => (
            <li key={version.number} className="flex flex-col gap-1 rounded-2xl border border-[#e7d7c8] bg-white p-4">
              <p>
                <Link href={`/budgets/${budgetId}/versions/${version.number}`} className={`${LINK_CLASS} font-semibold`}>
                  Version {version.number}
                </Link>
                <span className="text-[#5b5148]">
                  {" "}
                  published by {version.publishedBy ?? "a deleted account"} on {formatDate(version.publishedAt)} UTC
                  {version.basedOn === version.number - 1
                    ? ""
                    : version.basedOn === 0
                      ? ", not from a version"
                      : `, from version ${version.basedOn}`}
                </span>
              </p>
              {version.note === "" ? null : <p className="whitespace-pre-wrap">{version.note}</p>}
              {version.changes === null ? (
                <p className="text-[#5b5148]">First version.</p>
              ) : (
                <details>
                  <summary className="cursor-pointer">Changes from version {version.number - 1}</summary>
                  <div className="pt-2">
                    <BudgetDiffView diff={version.changes} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
