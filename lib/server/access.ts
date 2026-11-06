import { and, eq, isNotNull, or } from "drizzle-orm";
import { budget, budgetDraft, budgetMember, building, project } from "./schema";
import type { Db } from "./login";
import type { ROLES } from "./schema";

// Store functions take a grant instead of an id, so a Server Action cannot skip the access check.
declare const granted: unique symbol;
type Grant<Kind extends string, Fields> = Readonly<Fields> & { readonly [granted]: Kind };

// A member's role. The building admin has no member row and can do everything.
export type Role = (typeof ROLES)[number];
export type BudgetRole = Role | "admin";

export type BuildingAdmin = Grant<"building", { userId: string; buildingId: string }>;
// The admin, or a member of a budget in the building, who sees only the budgets shared with them.
export type BuildingAccess = Grant<"building-view", { userId: string; buildingId: string; isAdmin: boolean }>;
export type ProjectAdmin = Grant<"project", { userId: string; buildingId: string; projectId: string }>;
// Sees published versions and the changelog.
export type BudgetAccess = Grant<"budget", { userId: string; budgetId: string; role: BudgetRole }>;
// Sees drafts and creates them.
export type BudgetEditor = Grant<"budget-editor", { userId: string; budgetId: string }>;
// Manages members and invites.
export type BudgetAdmin = Grant<"budget-admin", { userId: string; budgetId: string }>;
export type DraftAccess = Grant<"draft", { userId: string; budgetId: string; draftId: string; isAuthor: boolean; isAdmin: boolean }>;
export type DraftAuthor = Grant<"draft-author", { userId: string; budgetId: string; draftId: string }>;
// Publishes or deletes a draft.
export type DraftPublisher = Grant<"draft-publisher", { userId: string; budgetId: string; draftId: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids come from URLs and forms. Postgres rejects a malformed uuid with an error, so treat it as not found.
export const isUuid = (value: string): boolean => UUID.test(value);

export const adminOfBuilding = async (db: Db, userId: string, buildingId: string): Promise<BuildingAdmin | null> => {
  if (!isUuid(buildingId)) {
    return null;
  }
  const found = await db.$count(building, and(eq(building.id, buildingId), eq(building.adminId, userId)));
  return found > 0 ? ({ userId, buildingId } as BuildingAdmin) : null;
};

export const accessBuilding = async (db: Db, userId: string, buildingId: string): Promise<BuildingAccess | null> => {
  if (!isUuid(buildingId)) {
    return null;
  }
  const [row] = await db
    .select({ adminId: building.adminId })
    .from(building)
    .leftJoin(project, eq(project.buildingId, building.id))
    .leftJoin(budget, eq(budget.projectId, project.id))
    .leftJoin(budgetMember, and(eq(budgetMember.budgetId, budget.id), eq(budgetMember.userId, userId)))
    .where(and(eq(building.id, buildingId), or(eq(building.adminId, userId), isNotNull(budgetMember.userId))))
    .limit(1);
  return row === undefined ? null : ({ userId, buildingId, isAdmin: row.adminId === userId } as BuildingAccess);
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
    .select({ adminId: building.adminId, role: budgetMember.role })
    .from(budget)
    .innerJoin(project, eq(project.id, budget.projectId))
    .innerJoin(building, eq(building.id, project.buildingId))
    .leftJoin(budgetMember, and(eq(budgetMember.budgetId, budget.id), eq(budgetMember.userId, userId)))
    .where(eq(budget.id, budgetId));
  const role = row === undefined ? null : row.adminId === userId ? "admin" : row.role;
  return role === null ? null : ({ userId, budgetId, role } as BudgetAccess);
};

export const editorOfBudget = (access: BudgetAccess): BudgetEditor | null =>
  access.role === "viewer" ? null : ({ userId: access.userId, budgetId: access.budgetId } as BudgetEditor);

export const adminOfBudget = (access: BudgetAccess): BudgetAdmin | null =>
  access.role === "admin" ? ({ userId: access.userId, budgetId: access.budgetId } as BudgetAdmin) : null;

// A viewer sees no drafts. An editor sees every draft in the budget, but edits only their own.
export const accessDraft = async (db: Db, userId: string, budgetId: string, draftId: string): Promise<DraftAccess | null> => {
  const access = isUuid(draftId) ? await accessBudget(db, userId, budgetId) : null;
  if (access === null || editorOfBudget(access) === null) {
    return null;
  }
  const [row] = await db
    .select({ authorId: budgetDraft.authorId })
    .from(budgetDraft)
    .where(and(eq(budgetDraft.id, draftId), eq(budgetDraft.budgetId, budgetId)));
  return row === undefined
    ? null
    : ({ userId, budgetId, draftId, isAuthor: row.authorId === userId, isAdmin: access.role === "admin" } as DraftAccess);
};

// Only the author edits a draft, even when someone else administers the building.
export const authorOfDraft = (access: DraftAccess): DraftAuthor | null =>
  access.isAuthor ? ({ userId: access.userId, budgetId: access.budgetId, draftId: access.draftId } as DraftAuthor) : null;

// The author publishes or deletes their draft. The building admin may publish or delete any draft.
export const publisherOfDraft = (access: DraftAccess): DraftPublisher | null =>
  access.isAuthor || access.isAdmin
    ? ({ userId: access.userId, budgetId: access.budgetId, draftId: access.draftId } as DraftPublisher)
    : null;
