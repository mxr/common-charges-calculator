import { and, asc, desc, eq, sql } from "drizzle-orm";
import { EMPTY_BUDGET, normalizeBudget } from "../budget";
import { diffBudgets } from "../diff";
import { authUser } from "./auth-schema";
import { budget, budgetDraft, budgetVersion, building, project } from "./schema";
import type { BudgetDiff } from "../diff";
import type { Budget } from "../types";
import type { BudgetAccess, BuildingAdmin, DraftAccess, DraftAuthor, ProjectAdmin } from "./access";
import type { Db } from "./login";

const MAX_NAME_LENGTH = 200;
const MAX_NOTE_LENGTH = 2000;

// Names come from form fields.
export const parseName = (value: unknown): string | null => {
  const name = typeof value === "string" ? value.trim() : "";
  return name === "" || name.length > MAX_NAME_LENGTH ? null : name;
};

// A publish note comes from a form field and may be empty.
export const parseNote = (value: unknown): string | null => {
  const note = typeof value === "string" ? value.trim() : "";
  return note.length > MAX_NOTE_LENGTH ? null : note;
};

// Version numbers come from URLs and forms. The bound keeps the value inside a Postgres integer.
export const parseVersionNumber = (value: unknown): number | null =>
  typeof value === "string" && /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : null;

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

// The latest version, or the newest draft when nothing is published yet.
const latestContent = async (db: Db, budgetId: string): Promise<Budget | null> => {
  const [version] = await db
    .select({ content: budgetVersion.content })
    .from(budgetVersion)
    .innerJoin(budget, and(eq(budget.id, budgetVersion.budgetId), eq(budget.latestVersion, budgetVersion.number)))
    .where(eq(budgetVersion.budgetId, budgetId));
  if (version !== undefined) {
    return normalizeBudget(version.content);
  }
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

export type DraftSummary = Named & { baseVersion: number; revision: number; updatedAt: Date };
export type BudgetDetail = { name: string; latestVersion: number; building: Named; project: Named; drafts: DraftSummary[] };

// A draft grant implies access to its budget.
export const getBudget = async (db: Db, access: BudgetAccess | DraftAccess): Promise<BudgetDetail> => {
  const found = first(
    await db
      .select({
        name: budget.name,
        latestVersion: budget.latestVersion,
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
    .select({
      id: budgetDraft.id,
      name: budgetDraft.name,
      baseVersion: budgetDraft.baseVersion,
      revision: budgetDraft.revision,
      updatedAt: budgetDraft.updatedAt,
    })
    .from(budgetDraft)
    .where(eq(budgetDraft.budgetId, access.budgetId))
    .orderBy(desc(budgetDraft.updatedAt), desc(budgetDraft.id));
  return {
    name: found.name,
    latestVersion: found.latestVersion,
    building: { id: found.buildingId, name: found.buildingName },
    project: { id: found.projectId, name: found.projectName },
    drafts,
  };
};

const insertDraft = async (db: Db, budgetId: string, authorId: string, name: string, content: Budget, baseVersion = 0): Promise<string> => {
  return first(await db.insert(budgetDraft).values({ budgetId, authorId, name, content, baseVersion }).returning({ id: budgetDraft.id }))
    .id;
};

export const createDraft = (db: Db, access: BudgetAccess, name: string, content: Budget): Promise<string> =>
  insertDraft(db, access.budgetId, access.userId, name, content);

// Restoring an old version starts here too. Publishing the draft makes it the newest version.
export const createDraftFromVersion = async (db: Db, access: BudgetAccess, name: string, number: number): Promise<string | null> => {
  const version = await getVersion(db, access, number);
  return version === null ? null : insertDraft(db, access.budgetId, access.userId, name, version.content, number);
};

export type Draft = { name: string; baseVersion: number; revision: number; content: Budget };

export const getDraft = async (db: Db, access: DraftAuthor): Promise<Draft> => {
  const found = first(
    await db
      .select({
        name: budgetDraft.name,
        baseVersion: budgetDraft.baseVersion,
        revision: budgetDraft.revision,
        content: budgetDraft.content,
      })
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

export type VersionSummary = {
  number: number;
  basedOn: number;
  note: string;
  // Null when the account no longer exists.
  publishedBy: string | null;
  publishedAt: Date;
};
export type Version = VersionSummary & { content: Budget };

const versionFields = {
  number: budgetVersion.number,
  basedOn: budgetVersion.basedOn,
  note: budgetVersion.note,
  publishedBy: authUser.email,
  publishedAt: budgetVersion.publishedAt,
  content: budgetVersion.content,
};

// A draft grant implies access to its budget.
export const getVersion = async (db: Db, access: BudgetAccess | DraftAccess, number: number): Promise<Version | null> => {
  const [row] = await db
    .select(versionFields)
    .from(budgetVersion)
    .leftJoin(authUser, eq(authUser.id, budgetVersion.publishedBy))
    .where(and(eq(budgetVersion.budgetId, access.budgetId), eq(budgetVersion.number, number)));
  return row === undefined ? null : { ...row, content: normalizeBudget(row.content) };
};

// Null changes means the first version, which has nothing before it.
export type ChangelogEntry = VersionSummary & { changes: BudgetDiff | null };

// Newest first. Each entry compares a version with the one before it.
export const getChangelog = async (db: Db, access: BudgetAccess): Promise<ChangelogEntry[]> => {
  const rows = await db
    .select(versionFields)
    .from(budgetVersion)
    .leftJoin(authUser, eq(authUser.id, budgetVersion.publishedBy))
    .where(eq(budgetVersion.budgetId, access.budgetId))
    .orderBy(asc(budgetVersion.number));
  let previous: Budget | null = null;
  const entries: ChangelogEntry[] = [];
  for (const { content, ...summary } of rows) {
    const current = normalizeBudget(content);
    entries.push({ ...summary, changes: previous === null ? null : diffBudgets(previous, current) });
    previous = current;
  }
  return entries.reverse();
};

export type PublishRequest = {
  // The revision the author last saw, so a publish cannot include edits they have not seen.
  revision: number;
  note: string;
  // The latest version the author reviewed. A draft that started from an older version publishes only after that review.
  confirmedLatest: number;
};

export type PublishResult =
  | { status: "published"; number: number }
  | { status: "behind"; latest: number; changes: BudgetDiff }
  | { status: "stale" }
  | { status: "missing" };

// Needs a driver with transactions. The primary key on budget_version is the last guard against a duplicate number.
export const publishDraft = (db: Db, access: DraftAccess, { revision, note, confirmedLatest }: PublishRequest): Promise<PublishResult> =>
  db.transaction(async (tx): Promise<PublishResult> => {
    // Publishes of one budget wait on this lock, so each one takes the next number.
    const { latest } = first(
      await tx.select({ latest: budget.latestVersion }).from(budget).where(eq(budget.id, access.budgetId)).for("update"),
    );
    // A save that arrives during the publish waits on this lock, then finds the draft gone.
    const [draft] = await tx
      .select({ baseVersion: budgetDraft.baseVersion, revision: budgetDraft.revision, content: budgetDraft.content })
      .from(budgetDraft)
      .where(eq(budgetDraft.id, access.draftId))
      .for("update");
    if (draft === undefined) {
      return { status: "missing" };
    }
    if (draft.revision !== revision) {
      return { status: "stale" };
    }
    const content = normalizeBudget(draft.content);
    if (draft.baseVersion < latest && confirmedLatest !== latest) {
      const { content: published } = first(
        await tx
          .select({ content: budgetVersion.content })
          .from(budgetVersion)
          .where(and(eq(budgetVersion.budgetId, access.budgetId), eq(budgetVersion.number, latest))),
      );
      return { status: "behind", latest, changes: diffBudgets(normalizeBudget(published), content) };
    }
    const number = latest + 1;
    await tx
      .insert(budgetVersion)
      .values({ budgetId: access.budgetId, number, basedOn: draft.baseVersion, note, content, publishedBy: access.userId });
    await tx.update(budget).set({ latestVersion: number }).where(eq(budget.id, access.budgetId));
    await tx.delete(budgetDraft).where(eq(budgetDraft.id, access.draftId));
    return { status: "published", number };
  });
