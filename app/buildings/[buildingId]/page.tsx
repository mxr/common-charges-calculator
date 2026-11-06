import Link from "next/link";
import { notFound } from "next/navigation";
import { PendingSave } from "@/app/_components/pending-save";
import { BUTTON_CLASS, INPUT_CLASS, LINK_CLASS } from "@/app/_components/styles";
import { getDb, requireUser } from "@/app/_server/services";
import { accessBuilding } from "@/lib/server/access";
import { getBuilding } from "@/lib/server/store";
import { createBudgetAction, createProjectAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function BuildingPage({ params }: { params: Promise<{ buildingId: string }> }) {
  const { buildingId } = await params;
  const user = await requireUser();
  const db = getDb();
  const access = await accessBuilding(db, user.id, buildingId);
  if (access === null) {
    notFound();
  }
  const building = await getBuilding(db, access);
  const allBudgets = building.projects.flatMap((project) => project.budgets.map((budget) => ({ ...budget, project: project.name })));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <nav className="text-sm text-[#5b5148]">
        <Link href="/buildings" className={LINK_CLASS}>
          Buildings
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold">{building.name}</h1>
      <PendingSave />
      {access.isAdmin ? null : <p className="text-sm text-[#5b5148]">This building has budgets shared with you.</p>}
      {building.projects.length === 0 ? <p className="text-sm text-[#5b5148]">This building has no projects yet.</p> : null}
      {building.projects.map((project) => (
        <section key={project.id} className="flex flex-col gap-3 rounded-2xl border border-black/10 p-4">
          <h2 className="text-lg font-semibold">{project.name}</h2>
          {project.budgets.length === 0 ? (
            <p className="text-sm text-[#5b5148]">No budgets yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {project.budgets.map((budget) => (
                <li key={budget.id}>
                  <Link href={`/budgets/${budget.id}`} className={LINK_CLASS}>
                    {budget.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {access.isAdmin ? (
            <form action={createBudgetAction.bind(null, project.id)} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                New budget
                <input name="name" required maxLength={200} placeholder="Base case" className={INPUT_CLASS} />
              </label>
              {allBudgets.length === 0 ? null : (
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  Start from
                  <select name="copyFrom" defaultValue="" className={INPUT_CLASS}>
                    <option value="">An empty budget</option>
                    {allBudgets.map((budget) => (
                      <option key={budget.id} value={budget.id}>
                        A copy of {budget.project} / {budget.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="submit" className={BUTTON_CLASS}>
                Create
              </button>
            </form>
          ) : null}
        </section>
      ))}
      {access.isAdmin ? (
        <form action={createProjectAction.bind(null, buildingId)} className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            New project
            <input name="name" required maxLength={200} placeholder="FY2027" className={INPUT_CLASS} />
          </label>
          <button type="submit" className={BUTTON_CLASS}>
            Create
          </button>
        </form>
      ) : null}
    </main>
  );
}
