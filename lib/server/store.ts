import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { EMPTY_BUDGET, normalizeBudget } from "../budget";
import { diffBudgets } from "../diff";
import { accessBudget, isUuid } from "./access";
import { authUser } from "./auth-schema";
import { budget, budgetDraft, budgetInvite, budgetMember, budgetVersion, building, project, ROLES } from "./schema";
import type { SQL } from "drizzle-orm";
import type { BudgetDiff } from "../diff";
import type { Budget } from "../types";
import type {
  BudgetAccess,
  BudgetAdmin,
  BudgetEditor,
  BuildingAccess,
  BuildingAdmin,
  DraftAccess,
  DraftAuthor,
  DraftPublisher,
  ProjectAdmin,
  Role,
} from "./access";
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

// Parses a role from a form field.
export const parseRole = (value: unknown): Role | null => ROLES.find((role) => role === value) ?? null;

export type BuildingSummary = Named & { isAdmin: boolean };

// Buildings the account administers, and buildings with budgets shared with it.
export const listBuildings = async (db: Db, userId: string): Promise<BuildingSummary[]> => {
  const rows = await db
    .selectDistinct({ id: building.id, name: building.name, adminId: building.adminId })
    .from(building)
    .leftJoin(project, eq(project.buildingId, building.id))
    .leftJoin(budget, eq(budget.projectId, project.id))
    .leftJoin(budgetMember, and(eq(budgetMember.budgetId, budget.id), eq(budgetMember.userId, userId)))
    .where(or(eq(building.adminId, userId), isNotNull(budgetMember.userId)))
    .orderBy(asc(building.name), asc(building.id));
  return rows.map(({ adminId, ...row }) => ({ ...row, isAdmin: adminId === userId }));
};

export const createBuilding = async (db: Db, userId: string, name: string): Promise<string> => {
  return first(await db.insert(building).values({ name, adminId: userId }).returning({ id: building.id })).id;
};

export type ProjectSummary = Named & { budgets: Named[] };
export type BuildingDetail = { name: string; projects: ProjectSummary[] };

// A member sees only the budgets shared with them, and the projects that hold those budgets.
export const getBuilding = async (db: Db, access: BuildingAccess): Promise<BuildingDetail> => {
  const found = first(await db.select({ name: building.name }).from(building).where(eq(building.id, access.buildingId)));
  const rows = await db
    .select({ projectId: project.id, projectName: project.name, budgetId: budget.id, budgetName: budget.name })
    .from(project)
    .leftJoin(budget, eq(budget.projectId, project.id))
    .leftJoin(budgetMember, and(eq(budgetMember.budgetId, budget.id), eq(budgetMember.userId, access.userId)))
    .where(and(eq(project.buildingId, access.buildingId), access.isAdmin ? undefined : isNotNull(budgetMember.userId)))
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

export const renameBuilding = async (db: Db, access: BuildingAdmin, name: string): Promise<void> => {
  await db.update(building).set({ name }).where(eq(building.id, access.buildingId));
};

export const renameProject = async (db: Db, access: ProjectAdmin, name: string): Promise<void> => {
  await db.update(project).set({ name }).where(eq(project.id, access.projectId));
};

export const renameBudget = async (db: Db, access: BudgetAdmin, name: string): Promise<void> => {
  await db.update(budget).set({ name }).where(eq(budget.id, access.budgetId));
};

// A delete happens only when the typed name still matches, so a rename in another tab cannot be deleted by mistake.
// The foreign keys cascade to everything inside: projects, budgets, drafts, versions, members, and invites.
export const deleteBuilding = async (db: Db, access: BuildingAdmin, typedName: string): Promise<boolean> => {
  const rows = await db
    .delete(building)
    .where(and(eq(building.id, access.buildingId), eq(building.name, typedName)))
    .returning({ id: building.id });
  return rows.length > 0;
};

export const deleteProject = async (db: Db, access: ProjectAdmin, typedName: string): Promise<boolean> => {
  const rows = await db
    .delete(project)
    .where(and(eq(project.id, access.projectId), eq(project.name, typedName)))
    .returning({ id: project.id });
  return rows.length > 0;
};

export const deleteBudget = async (db: Db, access: BudgetAdmin, typedName: string): Promise<boolean> => {
  const rows = await db
    .delete(budget)
    .where(and(eq(budget.id, access.budgetId), eq(budget.name, typedName)))
    .returning({ id: budget.id });
  return rows.length > 0;
};

// What a delete removes, for its confirmation. Members lose access to every budget in it.
export type DeleteImpact = { budgets: number; drafts: number; versions: number; members: { userId: string; email: string | null }[] };

const impactOf = async (db: Db, budgets: SQL): Promise<DeleteImpact> => {
  const ids = db.select({ id: budget.id }).from(budget).where(budgets);
  const [budgetCount, drafts, versions, members] = await Promise.all([
    db.$count(budget, budgets),
    db.$count(budgetDraft, inArray(budgetDraft.budgetId, ids)),
    db.$count(budgetVersion, inArray(budgetVersion.budgetId, ids)),
    db
      .selectDistinct({ userId: budgetMember.userId, email: authUser.email })
      .from(budgetMember)
      .leftJoin(authUser, eq(authUser.id, budgetMember.userId))
      .where(inArray(budgetMember.budgetId, ids))
      .orderBy(asc(authUser.email), asc(budgetMember.userId)),
  ]);
  return { budgets: budgetCount, drafts, versions, members };
};

export const buildingImpact = (db: Db, access: BuildingAdmin): Promise<DeleteImpact> =>
  impactOf(db, inArray(budget.projectId, db.select({ id: project.id }).from(project).where(eq(project.buildingId, access.buildingId))));

export const projectImpact = (db: Db, access: ProjectAdmin): Promise<DeleteImpact> => impactOf(db, eq(budget.projectId, access.projectId));

export const budgetImpact = (db: Db, access: BudgetAdmin): Promise<DeleteImpact> => impactOf(db, eq(budget.id, access.budgetId));

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
  // The admin of the copied budget sees its drafts too.
  copyFrom: BudgetAdmin | null,
): Promise<{ budgetId: string; draftId: string }> => {
  const content = (copyFrom === null ? null : await latestContent(db, copyFrom.budgetId)) ?? EMPTY_BUDGET;
  const budgetId = first(await db.insert(budget).values({ projectId: access.projectId, name }).returning({ id: budget.id })).id;
  const draftId = await insertDraft(db, budgetId, access.userId, FIRST_DRAFT_NAME, content);
  return { budgetId, draftId };
};

export type BudgetDetail = { name: string; latestVersion: number; building: Named; project: Named };

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
  return {
    name: found.name,
    latestVersion: found.latestVersion,
    building: { id: found.buildingId, name: found.buildingName },
    project: { id: found.projectId, name: found.projectName },
  };
};

export type DraftSummary = Named & {
  authorId: string;
  // Null when the account no longer exists.
  author: string | null;
  baseVersion: number;
  revision: number;
  updatedAt: Date;
};

export const listDrafts = (db: Db, access: BudgetEditor): Promise<DraftSummary[]> =>
  db
    .select({
      id: budgetDraft.id,
      name: budgetDraft.name,
      authorId: budgetDraft.authorId,
      author: authUser.email,
      baseVersion: budgetDraft.baseVersion,
      revision: budgetDraft.revision,
      updatedAt: budgetDraft.updatedAt,
    })
    .from(budgetDraft)
    .leftJoin(authUser, eq(authUser.id, budgetDraft.authorId))
    .where(eq(budgetDraft.budgetId, access.budgetId))
    .orderBy(desc(budgetDraft.updatedAt), desc(budgetDraft.id));

const insertDraft = async (db: Db, budgetId: string, authorId: string, name: string, content: Budget, baseVersion = 0): Promise<string> => {
  return first(await db.insert(budgetDraft).values({ budgetId, authorId, name, content, baseVersion }).returning({ id: budgetDraft.id }))
    .id;
};

export const createDraft = (db: Db, access: BudgetEditor, name: string, content: Budget): Promise<string> =>
  insertDraft(db, access.budgetId, access.userId, name, content);

// Restoring an old version starts here too. Publishing the draft makes it the newest version.
export const createDraftFromVersion = async (db: Db, access: BudgetEditor, name: string, number: number): Promise<string | null> => {
  const version = await getVersion(db, access, number);
  return version === null ? null : insertDraft(db, access.budgetId, access.userId, name, version.content, number);
};

export type Draft = { name: string; author: string | null; baseVersion: number; revision: number; content: Budget };

// Anyone who sees a draft can read it. Only DraftAuthor saves it.
export const getDraft = async (db: Db, access: DraftAccess): Promise<Draft> => {
  const found = first(
    await db
      .select({
        name: budgetDraft.name,
        author: authUser.email,
        baseVersion: budgetDraft.baseVersion,
        revision: budgetDraft.revision,
        content: budgetDraft.content,
      })
      .from(budgetDraft)
      .leftJoin(authUser, eq(authUser.id, budgetDraft.authorId))
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

// A rename leaves the revision alone, so it does not make an open editor or a publish stale.
export const renameDraft = async (db: Db, access: DraftAuthor, name: string): Promise<void> => {
  await db.update(budgetDraft).set({ name }).where(eq(budgetDraft.id, access.draftId));
};

export const deleteDraft = async (db: Db, access: DraftPublisher): Promise<void> => {
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
export const getVersion = async (db: Db, access: BudgetAccess | BudgetEditor | DraftAccess, number: number): Promise<Version | null> => {
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
export const publishDraft = (db: Db, access: DraftPublisher, { revision, note, confirmedLatest }: PublishRequest): Promise<PublishResult> =>
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

export type Member = { userId: string; email: string | null; role: Role };

export const listMembers = (db: Db, access: BudgetAdmin): Promise<Member[]> =>
  db
    .select({ userId: budgetMember.userId, email: authUser.email, role: budgetMember.role })
    .from(budgetMember)
    .leftJoin(authUser, eq(authUser.id, budgetMember.userId))
    .where(eq(budgetMember.budgetId, access.budgetId))
    .orderBy(asc(authUser.email), asc(budgetMember.userId));

// A member keeps their drafts after a role change or removal, so the admin can still publish or delete them.
export const setMemberRole = async (db: Db, access: BudgetAdmin, userId: string, role: Role): Promise<void> => {
  if (isUuid(userId)) {
    await db
      .update(budgetMember)
      .set({ role })
      .where(and(eq(budgetMember.budgetId, access.budgetId), eq(budgetMember.userId, userId)));
  }
};

export const removeMember = async (db: Db, access: BudgetAdmin, userId: string): Promise<void> => {
  if (isUuid(userId)) {
    await db.delete(budgetMember).where(and(eq(budgetMember.budgetId, access.budgetId), eq(budgetMember.userId, userId)));
  }
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

// Returns the token for the link. Only its hash is stored, so the link cannot be shown again.
export const createInvite = async (db: Db, access: BudgetAdmin, role: Role, now: Date): Promise<string> => {
  const token = randomBytes(32).toString("base64url");
  await db.insert(budgetInvite).values({
    budgetId: access.budgetId,
    role,
    tokenHash: hashToken(token),
    createdBy: access.userId,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  });
  return token;
};

export type Invite = { id: string; role: Role; expiresAt: Date };

// Invites that can still be accepted, newest first.
export const listInvites = (db: Db, access: BudgetAdmin, now: Date): Promise<Invite[]> =>
  db
    .select({ id: budgetInvite.id, role: budgetInvite.role, expiresAt: budgetInvite.expiresAt })
    .from(budgetInvite)
    .where(and(eq(budgetInvite.budgetId, access.budgetId), isNull(budgetInvite.acceptedBy), gt(budgetInvite.expiresAt, now)))
    .orderBy(desc(budgetInvite.expiresAt), desc(budgetInvite.id));

// An accepted invite stays, as a record of who joined through it.
export const revokeInvite = async (db: Db, access: BudgetAdmin, inviteId: string): Promise<void> => {
  if (isUuid(inviteId)) {
    await db
      .delete(budgetInvite)
      .where(and(eq(budgetInvite.id, inviteId), eq(budgetInvite.budgetId, access.budgetId), isNull(budgetInvite.acceptedBy)));
  }
};

// "open" means the account can already reach the budget. A revoked invite reads as invalid.
export type InviteStatus =
  | { status: "valid"; budgetId: string; budgetName: string; role: Role }
  | { status: "open"; budgetId: string }
  | { status: "invalid" | "expired" | "used" };

const checkInvite = async (db: Db, userId: string, token: string, now: Date, lock: boolean): Promise<InviteStatus> => {
  const query = db
    .select({
      budgetId: budgetInvite.budgetId,
      budgetName: budget.name,
      role: budgetInvite.role,
      expiresAt: budgetInvite.expiresAt,
      acceptedBy: budgetInvite.acceptedBy,
    })
    .from(budgetInvite)
    .innerJoin(budget, eq(budget.id, budgetInvite.budgetId))
    .where(eq(budgetInvite.tokenHash, hashToken(token)));
  const [invite] = lock ? await query.for("update", { of: budgetInvite }) : await query;
  if (invite === undefined) {
    return { status: "invalid" };
  }
  // Opening a link to a budget the account can already reach changes nothing, and leaves the link for someone else.
  if ((await accessBudget(db, userId, invite.budgetId)) !== null) {
    return { status: "open", budgetId: invite.budgetId };
  }
  if (invite.acceptedBy !== null) {
    return { status: "used" };
  }
  if (invite.expiresAt <= now) {
    return { status: "expired" };
  }
  return { status: "valid", budgetId: invite.budgetId, budgetName: invite.budgetName, role: invite.role };
};

// What accepting would do, without accepting.
export const peekInvite = (db: Db, userId: string, token: string, now: Date): Promise<InviteStatus> =>
  checkInvite(db, userId, token, now, false);

export type AcceptResult = { status: "joined" | "open"; budgetId: string } | { status: "invalid" | "expired" | "used" };

// Needs a driver with transactions. The lock makes a link work once when two accounts open it at the same time.
export const acceptInvite = (db: Db, userId: string, token: string, now: Date): Promise<AcceptResult> =>
  db.transaction(async (tx): Promise<AcceptResult> => {
    const checked = await checkInvite(tx, userId, token, now, true);
    if (checked.status !== "valid") {
      return checked;
    }
    await tx.insert(budgetMember).values({ budgetId: checked.budgetId, userId, role: checked.role });
    await tx
      .update(budgetInvite)
      .set({ acceptedBy: userId, acceptedAt: now })
      .where(eq(budgetInvite.tokenHash, hashToken(token)));
    return { status: "joined", budgetId: checked.budgetId };
  });
