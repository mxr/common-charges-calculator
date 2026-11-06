import Link from "next/link";
import { notFound } from "next/navigation";
import { BudgetDiffView } from "@/app/_components/budget-diff";
import { PendingSave } from "@/app/_components/pending-save";
import { BUTTON_CLASS, INPUT_CLASS, LINK_CLASS } from "@/app/_components/styles";
import { getDb, requireUser } from "@/app/_server/services";
import { accessBudget, adminOfBudget, editorOfBudget } from "@/lib/server/access";
import { getBudget, getChangelog, listDrafts, listInvites, listMembers } from "@/lib/server/store";
import { createDraftAction, removeMemberAction, revokeInviteAction, setMemberRoleAction } from "../actions";
import { CreateInvite } from "./create-invite";
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
  const editor = editorOfBudget(access);
  const admin = adminOfBudget(access);
  const [budget, changelog, drafts, members, invites] = await Promise.all([
    getBudget(db, access),
    getChangelog(db, access),
    editor === null ? null : listDrafts(db, editor),
    admin === null ? null : listMembers(db, admin),
    admin === null ? null : listInvites(db, admin, new Date()),
  ]);

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
      {editor === null ? (
        <p className="text-sm text-[#5b5148]">You can view published versions of this budget.</p>
      ) : (
        <PendingSave budgetId={budgetId} />
      )}
      <p className="text-sm">
        {budget.latestVersion === 0 ? (
          "Nothing is published yet. Publish a draft to make version 1."
        ) : (
          <Link href={`/budgets/${budgetId}/versions/${budget.latestVersion}`} className={LINK_CLASS}>
            View the latest version, version {budget.latestVersion}
          </Link>
        )}
      </p>
      {drafts === null ? null : (
        <>
          <h2 className="text-lg font-semibold">Drafts</h2>
          {drafts.length === 0 ? (
            <p className="text-sm text-[#5b5148]">No drafts.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Link href={`/budgets/${budgetId}/drafts/${draft.id}`} className={LINK_CLASS}>
                    {draft.name}
                  </Link>
                  <span className="text-[#5b5148]">
                    {draft.authorId === user.id ? "Yours" : `By ${draft.author ?? "a deleted account"}`},{" "}
                    {draft.baseVersion === 0 ? "not from a version" : `from version ${draft.baseVersion}`}, saved{" "}
                    {formatDate(draft.updatedAt)} UTC
                  </span>
                  {draft.authorId === user.id || admin !== null ? (
                    <>
                      <PublishButton budgetId={budgetId} draftId={draft.id} revision={draft.revision} />
                      <DeleteDraftButton budgetId={budgetId} draftId={draft.id} />
                    </>
                  ) : null}
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
        </>
      )}
      {members === null || invites === null ? null : (
        <>
          <h2 className="text-lg font-semibold">Members</h2>
          <p className="text-sm text-[#5b5148]">
            Viewers see published versions. Editors also see drafts, write their own, and publish them. You manage the building, so you can
            do everything.
          </p>
          {members.length === 0 ? (
            <p className="text-sm text-[#5b5148]">Nobody else has access.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {members.map((member) => (
                <li key={member.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="flex-1">{member.email ?? "A deleted account"}</span>
                  <form action={setMemberRoleAction.bind(null, budgetId, member.userId)} className="flex items-center gap-2">
                    <select name="role" defaultValue={member.role} aria-label="Role" className={INPUT_CLASS}>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button type="submit" className="underline">
                      Change
                    </button>
                  </form>
                  <form action={removeMemberAction.bind(null, budgetId, member.userId)}>
                    <button type="submit" className="text-red-700 underline">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {invites.length === 0 ? null : (
            <ul className="flex flex-col gap-2 text-sm">
              {invites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="flex-1 text-[#5b5148]">
                    Unused {invite.role} link, expires {formatDate(invite.expiresAt)} UTC
                  </span>
                  <form action={revokeInviteAction.bind(null, budgetId, invite.id)}>
                    <button type="submit" className="text-red-700 underline">
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <CreateInvite budgetId={budgetId} />
        </>
      )}
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
