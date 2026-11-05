import { and, eq } from "drizzle-orm";
import { budget, budgetDraft, building, project } from "./schema";
import type { Db } from "./login";

// Store functions take a grant instead of an id, so a Server Action cannot skip the access check.
declare const granted: unique symbol;
type Grant<Kind extends string, Fields> = Readonly<Fields> & { readonly [granted]: Kind };

export type BuildingAdmin = Grant<"building", { userId: string; buildingId: string }>;
export type ProjectAdmin = Grant<"project", { userId: string; buildingId: string; projectId: string }>;
export type BudgetAccess = Grant<"budget", { userId: string; budgetId: string }>;
export type DraftAccess = Grant<"draft", { userId: string; budgetId: string; draftId: string; isAuthor: boolean }>;
export type DraftAuthor = Grant<"draft-author", { userId: string; budgetId: string; draftId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids come from URLs and forms. Postgres rejects a malformed uuid with an error, so treat it as not found.
const isUuid = (value: string): boolean => UUID.test(value);

// Until sharing ships, only the building admin can reach anything in a building.
export const adminOfBuilding = async (db: Db, userId: string, buildingId: string): Promise<BuildingAdmin | null> => {
  if (!isUuid(buildingId)) {
    return null;
  }
  const found = await db.$count(building, and(eq(building.id, buildingId), eq(building.adminId, userId)));
  return found > 0 ? ({ userId, buildingId } as BuildingAdmin) : null;
};

export const adminOfProject = async (db: Db, userId: string, projectId: string): Promise<ProjectAdmin | null> => {
  if (!isUuid(projectId)) {
    return null;
  }
  const [row] = await db
    .select({ buildingId: project.buildingId })
    .from(project)
    .innerJoin(building, eq(building.id, project.buildingId))
    .where(and(eq(project.id, projectId), eq(building.adminId, userId)));
  return row === undefined ? null : ({ userId, buildingId: row.buildingId, projectId } as ProjectAdmin);
};

export const accessBudget = async (db: Db, userId: string, budgetId: string): Promise<BudgetAccess | null> => {
  if (!isUuid(budgetId)) {
    return null;
  }
  const [row] = await db
    .select({ id: budget.id })
    .from(budget)
    .innerJoin(project, eq(project.id, budget.projectId))
    .innerJoin(building, eq(building.id, project.buildingId))
    .where(and(eq(budget.id, budgetId), eq(building.adminId, userId)));
  return row === undefined ? null : ({ userId, budgetId } as BudgetAccess);
};

export const accessDraft = async (db: Db, userId: string, budgetId: string, draftId: string): Promise<DraftAccess | null> => {
  if (!isUuid(draftId) || (await accessBudget(db, userId, budgetId)) === null) {
    return null;
  }
  const [row] = await db
    .select({ authorId: budgetDraft.authorId })
    .from(budgetDraft)
    .where(and(eq(budgetDraft.id, draftId), eq(budgetDraft.budgetId, budgetId)));
  return row === undefined ? null : ({ userId, budgetId, draftId, isAuthor: row.authorId === userId } as DraftAccess);
};

// Only the author edits a draft, even when someone else administers the building.
export const authorOfDraft = (access: DraftAccess): DraftAuthor | null =>
  access.isAuthor ? ({ userId: access.userId, budgetId: access.budgetId, draftId: access.draftId } as DraftAuthor) : null;
