import { and, asc, desc, eq, sql } from "drizzle-orm";
import { EMPTY_BUDGET, normalizeBudget } from "../budget";
import { budget, budgetDraft, building, project } from "./schema";
import type { Budget } from "../types";
import type { BudgetAccess, BuildingAdmin, DraftAccess, DraftAuthor, ProjectAdmin } from "./access";
import type { Db } from "./login";

const MAX_NAME_LENGTH = 200;

// Names come from form fields.
export const parseName = (value: unknown): string | null => {
  const name = typeof value === "string" ? value.trim() : "";
  return name === "" || name.length > MAX_NAME_LENGTH ? null : name;
};

export type Named = { id: string; name: string };

// For queries that always return a row: an insert with returning, or a lookup behind a grant.
const first = <T>(rows: T[]): T => rows[0] as T;

export const listBuildings = (db: Db, userId: string): Promise<Named[]> =>
  db
    .select({ id: building.id, name: building.name })
    .from(building)
    .where(eq(building.adminId, userId))
    .orderBy(asc(building.name), asc(building.id));

export const createBuilding = async (db: Db, userId: string, name: string): Promise<string> => {
  return first(await db.insert(building).values({ name, adminId: userId }).returning({ id: building.id })).id;
};

export type ProjectSummary = Named & { budgets: Named[] };
export type BuildingDetail = { name: string; projects: ProjectSummary[] };

export const getBuilding = async (db: Db, access: BuildingAdmin): Promise<BuildingDetail> => {
  const found = first(await db.select({ name: building.name }).from(building).where(eq(building.id, access.buildingId)));
  const rows = await db
    .select({ projectId: project.id, projectName: project.name, budgetId: budget.id, budgetName: budget.name })
    .from(project)
    .leftJoin(budget, eq(budget.projectId, project.id))
    .where(eq(project.buildingId, access.buildingId))
    .orderBy(asc(project.name), asc(project.id), asc(budget.name), asc(budget.id));
  const projects = new Map<string, ProjectSummary>();
  for (const row of rows) {
    const summary = projects.get(row.projectId) ?? { id: row.projectId, name: row.projectName, budgets: [] };
    projects.set(row.projectId, summary);
    if (row.budgetId !== null && row.budgetName !== null) {
      summary.budgets.push({ id: row.budgetId, name: row.budgetName });
    }
  }
  return { name: found.name, projects: [...projects.values()] };
};

export const createProject = async (db: Db, access: BuildingAdmin, name: string): Promise<string> => {
  return first(await db.insert(project).values({ buildingId: access.buildingId, name }).returning({ id: project.id })).id;
};

// The newest draft stands in for a budget's content until versions exist.
const latestContent = async (db: Db, budgetId: string): Promise<Budget | null> => {
  const [row] = await db
    .select({ content: budgetDraft.content })
    .from(budgetDraft)
    .where(eq(budgetDraft.budgetId, budgetId))
    .orderBy(desc(budgetDraft.updatedAt), desc(budgetDraft.id))
    .limit(1);
  return row === undefined ? null : normalizeBudget(row.content);
};

export const FIRST_DRAFT_NAME = "First draft";

// A new budget starts with one draft, empty or copied from another budget.
export const createBudget = async (
  db: Db,
  access: ProjectAdmin,
  name: string,
  copyFrom: BudgetAccess | null,
): Promise<{ budgetId: string; draftId: string }> => {
  const content = (copyFrom === null ? null : await latestContent(db, copyFrom.budgetId)) ?? EMPTY_BUDGET;
  const budgetId = first(await db.insert(budget).values({ projectId: access.projectId, name }).returning({ id: budget.id })).id;
  const draftId = await insertDraft(db, budgetId, access.userId, FIRST_DRAFT_NAME, content);
  return { budgetId, draftId };
};

export type DraftSummary = Named & { updatedAt: Date };
export type BudgetDetail = { name: string; building: Named; project: Named; drafts: DraftSummary[] };

// A draft grant implies access to its budget.
export const getBudget = async (db: Db, access: BudgetAccess | DraftAccess): Promise<BudgetDetail> => {
  const found = first(
    await db
      .select({
        name: budget.name,
        projectId: project.id,
        projectName: project.name,
        buildingId: building.id,
        buildingName: building.name,
      })
      .from(budget)
      .innerJoin(project, eq(project.id, budget.projectId))
      .innerJoin(building, eq(building.id, project.buildingId))
      .where(eq(budget.id, access.budgetId)),
  );
  const drafts = await db
    .select({ id: budgetDraft.id, name: budgetDraft.name, updatedAt: budgetDraft.updatedAt })
    .from(budgetDraft)
    .where(eq(budgetDraft.budgetId, access.budgetId))
    .orderBy(desc(budgetDraft.updatedAt), desc(budgetDraft.id));
  return {
    name: found.name,
    building: { id: found.buildingId, name: found.buildingName },
    project: { id: found.projectId, name: found.projectName },
    drafts,
  };
};

const insertDraft = async (db: Db, budgetId: string, authorId: string, name: string, content: Budget): Promise<string> => {
  return first(await db.insert(budgetDraft).values({ budgetId, authorId, name, content }).returning({ id: budgetDraft.id })).id;
};

export const createDraft = (db: Db, access: BudgetAccess, name: string, content: Budget): Promise<string> =>
  insertDraft(db, access.budgetId, access.userId, name, content);

export type Draft = { name: string; revision: number; content: Budget };

export const getDraft = async (db: Db, access: DraftAuthor): Promise<Draft> => {
  const found = first(
    await db
      .select({ name: budgetDraft.name, revision: budgetDraft.revision, content: budgetDraft.content })
      .from(budgetDraft)
      .where(eq(budgetDraft.id, access.draftId)),
  );
  return { ...found, content: normalizeBudget(found.content) };
};

export type SaveResult = { status: "saved"; revision: number } | { status: "stale" };

// A save names the revision it started from, so a second tab cannot overwrite newer work.
export const saveDraft = async (db: Db, access: DraftAuthor, revision: number, content: Budget): Promise<SaveResult> => {
  const [row] = await db
    .update(budgetDraft)
    .set({ content, revision: sql`${budgetDraft.revision} + 1`, updatedAt: sql`now()` })
    .where(and(eq(budgetDraft.id, access.draftId), eq(budgetDraft.revision, revision)))
    .returning({ revision: budgetDraft.revision });
  return row === undefined ? { status: "stale" } : { status: "saved", revision: row.revision };
};

export const deleteDraft = async (db: Db, access: DraftAccess): Promise<void> => {
  await db.delete(budgetDraft).where(eq(budgetDraft.id, access.draftId));
};
