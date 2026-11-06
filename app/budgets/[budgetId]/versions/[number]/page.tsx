import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Calculator } from "@/app/_components/calculator";
import { INPUT_CLASS, LINK_CLASS, PILL_BUTTON_CLASS } from "@/app/_components/styles";
import { getDb, requireUser } from "@/app/_server/services";
import { accessBudget, editorOfBudget } from "@/lib/server/access";
import { getBudget, getVersion, parseVersionNumber } from "@/lib/server/store";
import { createDraftAction } from "../../../actions";

export const dynamic = "force-dynamic";

const formatDate = (date: Date) => date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function VersionPage({ params }: { params: Promise<{ budgetId: string; number: string }> }) {
  const { budgetId, number: param } = await params;
  const user = await requireUser();
  const db = getDb();
  const access = await accessBudget(db, user.id, budgetId);
  const number = parseVersionNumber(param);
  const version = access === null || number === null ? null : await getVersion(db, access, number);
  if (access === null || version === null) {
    notFound();
  }
  const budget = await getBudget(db, access);
  const canEdit = editorOfBudget(access) !== null;

  return (
    <Suspense>
      <Calculator
        readOnly
        initialBudget={version.content}
        intro={
          <>
            <Link href={`/buildings/${budget.building.id}`} className={LINK_CLASS}>
              {budget.building.name}
            </Link>
            {` / ${budget.project.name} / `}
            <Link href={`/budgets/${budgetId}`} className={LINK_CLASS}>
              {budget.name}
            </Link>
            {` / Version ${version.number}${version.number === budget.latestVersion ? " (latest)" : ""}, published by ${version.publishedBy ?? "a deleted account"} on ${formatDate(version.publishedAt)} UTC. A published version cannot change.${canEdit ? " To change it, start a draft from it." : ""}`}
          </>
        }
        actions={
          // A draft from an old version restores it once published.
          canEdit ? (
            <form action={createDraftAction.bind(null, budgetId)} className="flex items-center gap-2">
              <input type="hidden" name="from" value={version.number} />
              <input
                name="name"
                required
                maxLength={200}
                aria-label="Draft name"
                defaultValue={`From version ${version.number}`}
                className={`${INPUT_CLASS} w-48`}
              />
              <button type="submit" className={`${PILL_BUTTON_CLASS} whitespace-nowrap`}>
                Start a draft from this version
              </button>
            </form>
          ) : null
        }
      />
    </Suspense>
  );
}
