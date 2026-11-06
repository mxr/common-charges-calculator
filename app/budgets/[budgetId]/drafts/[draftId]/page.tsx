import Link from "next/link";
import { notFound } from "next/navigation";
import { LINK_CLASS } from "@/app/_components/styles";
import { getDb, requireUser } from "@/app/_server/services";
import { accessDraft, authorOfDraft } from "@/lib/server/access";
import { getBudget, getDraft } from "@/lib/server/store";
import { DraftEditor } from "./draft-editor";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ budgetId: string; draftId: string }> }) {
  const { budgetId, draftId } = await params;
  const user = await requireUser();
  const db = getDb();
  const access = await accessDraft(db, user.id, budgetId, draftId);
  // The read-only view for someone else's draft comes with sharing.
  const author = access === null ? null : authorOfDraft(access);
  if (access === null || author === null) {
    notFound();
  }
  const [budget, draft] = await Promise.all([getBudget(db, access), getDraft(db, author)]);

  return (
    <DraftEditor
      budgetId={budgetId}
      draftId={draftId}
      revision={draft.revision}
      initialBudget={draft.content}
      intro={
        <>
          <Link href={`/buildings/${budget.building.id}`} className={LINK_CLASS}>
            {budget.building.name}
          </Link>
          {` / ${budget.project.name} / `}
          <Link href={`/budgets/${budgetId}`} className={LINK_CLASS}>
            {budget.name}
          </Link>
          {` / ${draft.name}. ${draft.baseVersion === 0 ? "Not from a version." : `From version ${draft.baseVersion}.`}`}
          {draft.baseVersion < budget.latestVersion
            ? ` Version ${budget.latestVersion} is newer, so publishing shows what would change first.`
            : ""}
          {" Changes save to your account as you work."}
        </>
      }
    />
  );
}
