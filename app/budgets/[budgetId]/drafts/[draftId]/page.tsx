import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Calculator } from "@/app/_components/calculator";
import { LINK_CLASS } from "@/app/_components/styles";
import { getDb, requireUser } from "@/app/_server/services";
import { accessDraft, authorOfDraft, publisherOfDraft } from "@/lib/server/access";
import { getBudget, getDraft } from "@/lib/server/store";
import { PublishButton } from "../../publish-button";
import { DraftEditor } from "./draft-editor";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ budgetId: string; draftId: string }> }) {
  const { budgetId, draftId } = await params;
  const user = await requireUser();
  const db = getDb();
  const access = await accessDraft(db, user.id, budgetId, draftId);
  if (access === null) {
    notFound();
  }
  const [budget, draft] = await Promise.all([getBudget(db, access), getDraft(db, access)]);
  const author = authorOfDraft(access);
  const publisher = publisherOfDraft(access);

  const intro = (
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
      {author === null
        ? ` This draft belongs to ${draft.author ?? "a deleted account"}, so you can read it but not change it.`
        : " Changes save to your account as you work."}
    </>
  );

  if (author !== null) {
    return <DraftEditor budgetId={budgetId} draftId={draftId} revision={draft.revision} initialBudget={draft.content} intro={intro} />;
  }
  return (
    <Suspense>
      <Calculator
        readOnly
        initialBudget={draft.content}
        intro={intro}
        actions={publisher === null ? null : <PublishButton budgetId={budgetId} draftId={draftId} revision={draft.revision} />}
      />
    </Suspense>
  );
}
