import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, EMPTY_BUDGET } from "../lib/budget";
import { diffBudgets } from "../lib/diff";
import {
  accessBudget,
  accessBuilding,
  accessDraft,
  adminOfBudget,
  adminOfBuilding,
  adminOfProject,
  authorOfDraft,
  editorOfBudget,
  publisherOfDraft,
} from "../lib/server/access";
import * as tables from "../lib/server/schema";
import {
  acceptInvite,
  budgetImpact,
  buildingImpact,
  createBudget,
  createBuilding,
  createDraft,
  createDraftFromVersion,
  createInvite,
  createProject,
  deleteBudget,
  deleteBuilding,
  deleteDraft,
  deleteProject,
  FIRST_DRAFT_NAME,
  getBudget,
  getBuilding,
  getChangelog,
  getDraft,
  getVersion,
  listBuildings,
  listDrafts,
  listInvites,
  listMembers,
  parseName,
  parseNote,
  parseRole,
  parseVersionNumber,
  peekInvite,
  projectImpact,
  publishDraft,
  removeMember,
  renameBudget,
  renameBuilding,
  renameDraft,
  renameProject,
  revokeInvite,
  saveDraft,
  setMemberRole,
} from "../lib/server/store";
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
} from "../lib/server/access";
import type { Db } from "../lib/server/login";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const EDITOR = "00000000-0000-4000-8000-000000000003";
const VIEWER = "00000000-0000-4000-8000-000000000004";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

let db: Db;

beforeEach(async () => {
  const pglite = drizzle(new PGlite());
  await migrate(pglite, { migrationsFolder: "drizzle" });
  // Neon Auth creates this table, outside the migrations.
  await pglite.execute(sql`create schema neon_auth`);
  await pglite.execute(sql`create table neon_auth."user" (id uuid primary key, email text not null)`);
  await pglite.execute(
    sql`insert into neon_auth."user" values (${ADMIN}, 'admin@example.com'), (${EDITOR}, 'editor@example.com'), (${VIEWER}, 'viewer@example.com')`,
  );
  db = pglite as unknown as Db;
});

// Builds one building with one project and one budget, owned by ADMIN.
const seed = async () => {
  const buildingId = await createBuilding(db, ADMIN, "Maple Court");
  const building = (await adminOfBuilding(db, ADMIN, buildingId)) as BuildingAdmin;
  const projectId = await createProject(db, building, "FY2027");
  const project = (await adminOfProject(db, ADMIN, projectId)) as ProjectAdmin;
  const { budgetId, draftId } = await createBudget(db, project, "Base case", null);
  const budget = (await accessBudget(db, ADMIN, budgetId)) as BudgetAccess;
  const draft = (await accessDraft(db, ADMIN, budgetId, draftId)) as DraftAccess;
  return {
    buildingId,
    building,
    projectId,
    project,
    budgetId,
    budget,
    editor: editorOfBudget(budget) as BudgetEditor,
    admin: adminOfBudget(budget) as BudgetAdmin,
    draftId,
    draft,
    author: authorOfDraft(draft) as DraftAuthor,
  };
};

const addMember = (budgetId: string, userId: string, role: Role) => db.insert(tables.budgetMember).values({ budgetId, userId, role });

const budgetAs = async (userId: string, budgetId: string) => (await accessBudget(db, userId, budgetId)) as BudgetAccess;
const editorAs = async (userId: string, budgetId: string) => editorOfBudget(await budgetAs(userId, budgetId)) as BudgetEditor;
const draftAs = async (userId: string, budgetId: string, draftId: string) =>
  (await accessDraft(db, userId, budgetId, draftId)) as DraftAccess;
const publisherAs = async (userId: string, budgetId: string, draftId: string) =>
  publisherOfDraft(await draftAs(userId, budgetId, draftId)) as DraftPublisher;

describe("parseName", () => {
  it.each([
    { name: "a trimmed name", value: "  Maple Court ", want: "Maple Court" },
    { name: "a blank name", value: "   ", want: null },
    { name: "a name that is too long", value: "x".repeat(201), want: null },
    { name: "a missing field", value: null, want: null },
  ])("parses $name", ({ value, want }) => {
    expect(parseName(value)).toBe(want);
  });
});

describe("parseNote", () => {
  it.each([
    { name: "a trimmed note", value: " Board approved ", want: "Board approved" },
    { name: "a blank note", value: "  ", want: "" },
    { name: "a missing field", value: null, want: "" },
    { name: "a note that is too long", value: "x".repeat(2001), want: null },
  ])("parses $name", ({ value, want }) => {
    expect(parseNote(value)).toBe(want);
  });
});

describe("parseRole", () => {
  it.each([
    { name: "viewer", value: "viewer", want: "viewer" },
    { name: "editor", value: "editor", want: "editor" },
    { name: "admin, which is not a member role", value: "admin", want: null },
    { name: "a missing field", value: null, want: null },
  ])("parses $name", ({ value, want }) => {
    expect(parseRole(value)).toBe(want);
  });
});

describe("parseVersionNumber", () => {
  it.each([
    { name: "a version number", value: "12", want: 12 },
    { name: "zero", value: "0", want: null },
    { name: "a leading zero", value: "01", want: null },
    { name: "a number too big for Postgres", value: "9999999999", want: null },
    { name: "text", value: "latest", want: null },
    { name: "a missing field", value: null, want: null },
  ])("parses $name", ({ value, want }) => {
    expect(parseVersionNumber(value)).toBe(want);
  });
});

describe("access", () => {
  it("lets the building admin reach everything in the building", async () => {
    const { buildingId, projectId, budgetId, draftId } = await seed();
    expect(await adminOfBuilding(db, ADMIN, buildingId)).toEqual({ userId: ADMIN, buildingId });
    expect(await adminOfProject(db, ADMIN, projectId)).toEqual({ userId: ADMIN, buildingId, projectId });
    expect(await accessBuilding(db, ADMIN, buildingId)).toEqual({ userId: ADMIN, buildingId, isAdmin: true });
    expect(await accessBudget(db, ADMIN, budgetId)).toEqual({ userId: ADMIN, budgetId, role: "admin" });
    expect(await accessDraft(db, ADMIN, budgetId, draftId)).toEqual({ userId: ADMIN, budgetId, draftId, isAuthor: true, isAdmin: true });
  });

  it("refuses another account", async () => {
    const { buildingId, projectId, budgetId, draftId } = await seed();
    expect(await adminOfBuilding(db, OTHER, buildingId)).toBeNull();
    expect(await adminOfProject(db, OTHER, projectId)).toBeNull();
    expect(await accessBuilding(db, OTHER, buildingId)).toBeNull();
    expect(await accessBudget(db, OTHER, budgetId)).toBeNull();
    expect(await accessDraft(db, OTHER, budgetId, draftId)).toBeNull();
  });

  it.each(["not-a-uuid", MISSING])("treats %s as not found", async (id) => {
    const { budgetId } = await seed();
    expect(await adminOfBuilding(db, ADMIN, id)).toBeNull();
    expect(await adminOfProject(db, ADMIN, id)).toBeNull();
    expect(await accessBuilding(db, ADMIN, id)).toBeNull();
    expect(await accessBudget(db, ADMIN, id)).toBeNull();
    expect(await accessDraft(db, ADMIN, budgetId, id)).toBeNull();
  });

  it("refuses a draft through a budget it does not belong to", async () => {
    const { project, draftId } = await seed();
    const { budgetId: otherBudgetId } = await createBudget(db, project, "New roof", null);
    expect(await accessDraft(db, ADMIN, otherBudgetId, draftId)).toBeNull();
  });

  it("lets only the author edit a draft", async () => {
    const { budgetId, draftId } = await seed();
    await db.update(tables.budgetDraft).set({ authorId: OTHER });
    const draft = (await accessDraft(db, ADMIN, budgetId, draftId)) as DraftAccess;
    expect(draft.isAuthor).toBe(false);
    expect(authorOfDraft(draft)).toBeNull();
    expect(publisherOfDraft(draft)).not.toBeNull();
  });
});

describe("buildings", () => {
  it("lists only the account's buildings, by name", async () => {
    const maple = await createBuilding(db, ADMIN, "Maple Court");
    await createBuilding(db, OTHER, "Elm House");
    const birch = await createBuilding(db, ADMIN, "Birch Lofts");
    expect(await listBuildings(db, ADMIN)).toEqual([
      { id: birch, name: "Birch Lofts", isAdmin: true },
      { id: maple, name: "Maple Court", isAdmin: true },
    ]);
  });

  it("shows projects with their budgets by name, including empty projects", async () => {
    const { buildingId, building, project, projectId, budgetId } = await seed();
    const { budgetId: roofId } = await createBudget(db, project, "New roof", null);
    const { budgetId: auditId } = await createBudget(db, project, "Audit", null);
    const emptyId = await createProject(db, building, "FY2028");
    expect(await getBuilding(db, (await accessBuilding(db, ADMIN, buildingId)) as BuildingAccess)).toEqual({
      name: "Maple Court",
      projects: [
        {
          id: projectId,
          name: "FY2027",
          budgets: [
            { id: auditId, name: "Audit" },
            { id: budgetId, name: "Base case" },
            { id: roofId, name: "New roof" },
          ],
        },
        { id: emptyId, name: "FY2028", budgets: [] },
      ],
    });
  });
});

describe("budgets", () => {
  it("starts a new budget with one empty draft", async () => {
    const { budget, editor, draft, draftId, buildingId, projectId } = await seed();
    expect(await getBudget(db, budget)).toEqual({
      name: "Base case",
      latestVersion: 0,
      building: { id: buildingId, name: "Maple Court" },
      project: { id: projectId, name: "FY2027" },
    });
    expect(await listDrafts(db, editor)).toMatchObject([
      { id: draftId, name: FIRST_DRAFT_NAME, authorId: ADMIN, author: "admin@example.com" },
    ]);
    expect(await getDraft(db, draft)).toEqual({
      name: FIRST_DRAFT_NAME,
      author: "admin@example.com",
      baseVersion: 0,
      revision: 0,
      content: EMPTY_BUDGET,
    });
    expect(await getBudget(db, draft)).toEqual(await getBudget(db, budget));
  });

  it("copies the newest draft of another budget", async () => {
    const { building, editor, admin, author } = await seed();
    const olderId = await createDraft(db, editor, "Older", EMPTY_BUDGET);
    await db
      .update(tables.budgetDraft)
      .set({ updatedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(tables.budgetDraft.id, olderId));
    await saveDraft(db, author, 0, DEFAULT_BUDGET);
    const nextYear = (await adminOfProject(db, ADMIN, await createProject(db, building, "FY2028"))) as ProjectAdmin;
    const { budgetId, draftId } = await createBudget(db, nextYear, "Base case", admin);
    expect((await getDraft(db, await draftAs(ADMIN, budgetId, draftId))).content).toEqual(DEFAULT_BUDGET);
  });

  it("starts empty when the copied budget has no drafts", async () => {
    const { project, admin, budgetId: copiedId, draftId: copiedDraftId, author } = await seed();
    await deleteDraft(db, await publisherAs(ADMIN, copiedId, copiedDraftId));
    const { budgetId, draftId } = await createBudget(db, project, "New roof", admin);
    expect((await getDraft(db, await draftAs(ADMIN, budgetId, draftId))).content).toEqual(EMPTY_BUDGET);
    expect(author.draftId).not.toBe(draftId);
  });
});

describe("drafts", () => {
  it("adds a draft with the given content, listed newest first", async () => {
    const { editor, budgetId, draftId } = await seed();
    const savedId = await createDraft(db, editor, "From the calculator", DEFAULT_BUDGET);
    await db
      .update(tables.budgetDraft)
      .set({ updatedAt: new Date("2026-11-01T00:00:00Z") })
      .where(eq(tables.budgetDraft.id, draftId));
    expect(await getDraft(db, await draftAs(ADMIN, budgetId, savedId))).toEqual({
      name: "From the calculator",
      author: "admin@example.com",
      baseVersion: 0,
      revision: 0,
      content: DEFAULT_BUDGET,
    });
    expect((await listDrafts(db, editor)).map((draft) => draft.id)).toEqual([savedId, draftId]);
  });

  it("saves with the current revision and refuses an old one", async () => {
    const { draft, author } = await seed();
    expect(await saveDraft(db, author, 0, DEFAULT_BUDGET)).toEqual({ status: "saved", revision: 1 });
    expect(await saveDraft(db, author, 0, EMPTY_BUDGET)).toEqual({ status: "stale" });
    expect(await getDraft(db, draft)).toMatchObject({ revision: 1, content: DEFAULT_BUDGET });
    expect(await saveDraft(db, author, 1, EMPTY_BUDGET)).toEqual({ status: "saved", revision: 2 });
  });

  it("normalizes stored content on read", async () => {
    const { draft } = await seed();
    await db.update(tables.budgetDraft).set({ content: { owners: [{ id: "o", name: "Ann" }] } as never });
    expect((await getDraft(db, draft)).content.owners).toEqual([{ id: "o", name: "Ann", isBoard: false, currentMonthly: 0 }]);
  });

  it("deletes a draft", async () => {
    const { editor, budgetId, draftId } = await seed();
    await deleteDraft(db, await publisherAs(ADMIN, budgetId, draftId));
    expect(await listDrafts(db, editor)).toEqual([]);
  });

  it("shows no author for an account that no longer exists", async () => {
    const { editor, draft } = await seed();
    await db.execute(sql`delete from neon_auth."user"`);
    expect(await listDrafts(db, editor)).toMatchObject([{ author: null }]);
    expect(await getDraft(db, draft)).toMatchObject({ author: null });
  });
});

// Publishing runs in a transaction, which PGlite supports like the WebSocket driver does.
const publish = (draft: DraftAccess, revision = 0, confirmedLatest = 0, note = "") =>
  publishDraft(db, publisherOfDraft(draft) as DraftPublisher, { revision, note, confirmedLatest });

describe("versions", () => {
  it("publishes a draft as version 1 and removes the draft", async () => {
    const { budget, editor, draft, author } = await seed();
    await saveDraft(db, author, 0, DEFAULT_BUDGET);
    expect(await publish(draft, 1, 0, "Board approved")).toEqual({ status: "published", number: 1 });
    expect(await getBudget(db, budget)).toMatchObject({ latestVersion: 1 });
    expect(await listDrafts(db, editor)).toEqual([]);
    expect(await getVersion(db, budget, 1)).toEqual({
      number: 1,
      basedOn: 0,
      note: "Board approved",
      publishedBy: "admin@example.com",
      publishedAt: expect.any(Date),
      content: DEFAULT_BUDGET,
    });
  });

  it("numbers versions in order and records the version each draft started from", async () => {
    const { budget, editor, draft } = await seed();
    await publish(draft);
    const restoreId = (await createDraftFromVersion(db, editor, "Restore", 1)) as string;
    const restore = (await accessDraft(db, ADMIN, budget.budgetId, restoreId)) as DraftAccess;
    expect(await listDrafts(db, editor)).toMatchObject([{ id: restoreId, baseVersion: 1, revision: 0 }]);
    expect(await publish(restore)).toEqual({ status: "published", number: 2 });
    expect(await getVersion(db, budget, 2)).toMatchObject({ number: 2, basedOn: 1, content: EMPTY_BUDGET });
  });

  it("asks to review the latest version when another publish came first", async () => {
    const { budget, editor, draft, author } = await seed();
    const otherId = await createDraft(db, editor, "Other", EMPTY_BUDGET);
    await saveDraft(db, author, 0, DEFAULT_BUDGET);
    expect(await publish(draft, 1)).toEqual({ status: "published", number: 1 });
    const other = (await accessDraft(db, ADMIN, budget.budgetId, otherId)) as DraftAccess;
    expect(await publish(other)).toEqual({ status: "behind", latest: 1, changes: diffBudgets(DEFAULT_BUDGET, EMPTY_BUDGET) });
    expect(await publish(other, 0, 1)).toEqual({ status: "published", number: 2 });
  });

  it("refuses a publish that names an old revision", async () => {
    const { budget, draft, author } = await seed();
    await saveDraft(db, author, 0, DEFAULT_BUDGET);
    expect(await publish(draft, 0)).toEqual({ status: "stale" });
    expect((await getBudget(db, budget)).latestVersion).toBe(0);
  });

  it("reports a draft deleted after the access check", async () => {
    const { draft } = await seed();
    await deleteDraft(db, publisherOfDraft(draft) as DraftPublisher);
    expect(await publish(draft)).toEqual({ status: "missing" });
  });

  it("refuses a second version with the same number", async () => {
    const { budgetId, draft } = await seed();
    await publish(draft);
    const duplicate = { budgetId, number: 1, basedOn: 0, content: EMPTY_BUDGET, publishedBy: ADMIN };
    await expect(db.insert(tables.budgetVersion).values(duplicate)).rejects.toThrow();
  });

  it("finds no version that was not published, or that belongs to another budget", async () => {
    const { project, budget, draft } = await seed();
    await publish(draft);
    const { budgetId: otherId } = await createBudget(db, project, "New roof", null);
    const other = await editorAs(ADMIN, otherId);
    expect(await getVersion(db, budget, 2)).toBeNull();
    expect(await getVersion(db, other, 1)).toBeNull();
    expect(await createDraftFromVersion(db, other, "Restore", 1)).toBeNull();
  });

  it("shows no publisher for an account that no longer exists", async () => {
    const { budget, draft } = await seed();
    await publish(draft);
    await db.execute(sql`delete from neon_auth."user"`);
    expect(await getVersion(db, budget, 1)).toMatchObject({ publishedBy: null });
  });

  it("lists the changelog newest first, each version against the one before", async () => {
    const { budget, editor, draft } = await seed();
    await publish(draft, 0, 0, "First");
    const secondId = await createDraft(db, editor, "Second", DEFAULT_BUDGET);
    await publish((await accessDraft(db, ADMIN, budget.budgetId, secondId)) as DraftAccess, 0, 1, "Second");
    expect(await getChangelog(db, budget)).toEqual([
      expect.objectContaining({
        number: 2,
        note: "Second",
        publishedBy: "admin@example.com",
        changes: diffBudgets(EMPTY_BUDGET, DEFAULT_BUDGET),
      }),
      expect.objectContaining({ number: 1, note: "First", changes: null }),
    ]);
  });

  it("copies the latest version into a new budget, ahead of newer drafts", async () => {
    const { building, budget, editor, admin, draft } = await seed();
    await publish(draft);
    const restoreId = (await createDraftFromVersion(db, editor, "Restore", 1)) as string;
    const restore = (await accessDraft(db, ADMIN, budget.budgetId, restoreId)) as DraftAccess;
    await saveDraft(db, authorOfDraft(restore) as DraftAuthor, 0, DEFAULT_BUDGET);
    const nextYear = (await adminOfProject(db, ADMIN, await createProject(db, building, "FY2028"))) as ProjectAdmin;
    const { budgetId, draftId } = await createBudget(db, nextYear, "Base case", admin);
    expect(await getDraft(db, await draftAs(ADMIN, budgetId, draftId))).toMatchObject({ baseVersion: 0, content: EMPTY_BUDGET });
  });
});

// The admin and an editor each wrote one draft, and a viewer and a non-member look on.
const seedShared = async () => {
  const seeded = await seed();
  await addMember(seeded.budgetId, EDITOR, "editor");
  await addMember(seeded.budgetId, VIEWER, "viewer");
  const editorDraftId = await createDraft(db, await editorAs(EDITOR, seeded.budgetId), "Editor's", EMPTY_BUDGET);
  return { ...seeded, editorDraftId };
};

type Shared = Awaited<ReturnType<typeof seedShared>>;

const onBudget =
  (check: (access: BudgetAccess) => boolean) =>
  async (userId: string, { budgetId }: Shared): Promise<boolean> => {
    const access = await accessBudget(db, userId, budgetId);
    return access !== null && check(access);
  };

// Reports [on the admin's draft, on the editor's draft].
const onDrafts =
  (check: (access: DraftAccess) => boolean) =>
  ({ budgetId, draftId, editorDraftId }: Shared, userId: string): Promise<boolean[]> =>
    Promise.all(
      [draftId, editorDraftId].map(async (id) => {
        const access = await accessDraft(db, userId, budgetId, id);
        return access !== null && check(access);
      }),
    );

describe("permissions", () => {
  it.each([
    { action: "see published versions and the changelog", check: onBudget(() => true), viewer: true, editor: true, admin: true },
    { action: "create a draft", check: onBudget((access) => editorOfBudget(access) !== null), viewer: false, editor: true, admin: true },
    {
      action: "manage members and invites, or rename or delete the budget",
      check: onBudget((access) => adminOfBudget(access) !== null),
      viewer: false,
      editor: false,
      admin: true,
    },
    {
      action: "create a budget, or rename or delete the project",
      check: async (userId: string, { projectId }: Shared) => (await adminOfProject(db, userId, projectId)) !== null,
      viewer: false,
      editor: false,
      admin: true,
    },
    {
      action: "create a project, or rename or delete the building",
      check: async (userId: string, { buildingId }: Shared) => (await adminOfBuilding(db, userId, buildingId)) !== null,
      viewer: false,
      editor: false,
      admin: true,
    },
  ])("lets a role $action", async ({ check, viewer, editor, admin }) => {
    const shared = await seedShared();
    const got = { viewer: await check(VIEWER, shared), editor: await check(EDITOR, shared), admin: await check(ADMIN, shared) };
    expect(got).toEqual({ viewer, editor, admin });
    expect(await check(OTHER, shared)).toBe(false);
  });

  it.each([
    { action: "see drafts", check: () => true, viewer: [false, false], editor: [true, true], admin: [true, true] },
    {
      action: "edit or rename a draft",
      check: (access: DraftAccess) => authorOfDraft(access) !== null,
      viewer: [false, false],
      editor: [false, true],
      admin: [true, false],
    },
    {
      action: "publish or delete a draft",
      check: (access: DraftAccess) => publisherOfDraft(access) !== null,
      viewer: [false, false],
      editor: [false, true],
      admin: [true, true],
    },
  ])("lets a role $action, on the admin's draft and the editor's draft", async ({ check, viewer, editor, admin }) => {
    const shared = await seedShared();
    const on = onDrafts(check);
    const got = { viewer: await on(shared, VIEWER), editor: await on(shared, EDITOR), admin: await on(shared, ADMIN) };
    expect(got).toEqual({ viewer, editor, admin });
    expect(await on(shared, OTHER)).toEqual([false, false]);
  });

  it("gives members their role", async () => {
    const { budgetId } = await seedShared();
    expect(await accessBudget(db, VIEWER, budgetId)).toEqual({ userId: VIEWER, budgetId, role: "viewer" });
    expect(await accessBudget(db, EDITOR, budgetId)).toEqual({ userId: EDITOR, budgetId, role: "editor" });
  });

  it("publishes an editor's draft for its author and for the admin", async () => {
    const { budget, budgetId, editorDraftId } = await seedShared();
    const editorDraft = await draftAs(EDITOR, budgetId, editorDraftId);
    expect(editorDraft).toMatchObject({ isAuthor: true, isAdmin: false });
    expect(await publish(editorDraft)).toEqual({ status: "published", number: 1 });
    expect(await getVersion(db, budget, 1)).toMatchObject({ publishedBy: "editor@example.com" });
    const secondId = await createDraft(db, await editorAs(EDITOR, budgetId), "Second", DEFAULT_BUDGET);
    expect(await publish(await draftAs(ADMIN, budgetId, secondId), 0, 1)).toEqual({ status: "published", number: 2 });
    expect(await getVersion(db, budget, 2)).toMatchObject({ publishedBy: "admin@example.com" });
  });

  it("shows a member only the shared budgets in a building, and the projects that hold them", async () => {
    const { buildingId, building, project, projectId, budgetId } = await seedShared();
    const { budgetId: roofId } = await createBudget(db, project, "New roof", null);
    await createProject(db, building, "FY2028");
    const otherBuildingId = await createBuilding(db, ADMIN, "Elm House");
    const elmProject = (await adminOfProject(
      db,
      ADMIN,
      await createProject(db, (await adminOfBuilding(db, ADMIN, otherBuildingId)) as BuildingAdmin, "FY2027"),
    )) as ProjectAdmin;
    const { budgetId: elmId } = await createBudget(db, elmProject, "Base case", null);
    await addMember(roofId, VIEWER, "editor");
    await addMember(elmId, EDITOR, "viewer");

    const viewerBuilding = (await accessBuilding(db, VIEWER, buildingId)) as BuildingAccess;
    expect(viewerBuilding).toEqual({ userId: VIEWER, buildingId, isAdmin: false });
    expect(await getBuilding(db, viewerBuilding)).toEqual({
      name: "Maple Court",
      projects: [
        {
          id: projectId,
          name: "FY2027",
          budgets: [
            { id: budgetId, name: "Base case" },
            { id: roofId, name: "New roof" },
          ],
        },
      ],
    });
    expect(await accessBuilding(db, VIEWER, otherBuildingId)).toBeNull();
    expect(await listBuildings(db, VIEWER)).toEqual([{ id: buildingId, name: "Maple Court", isAdmin: false }]);
    expect(await listBuildings(db, EDITOR)).toEqual([
      { id: otherBuildingId, name: "Elm House", isAdmin: false },
      { id: buildingId, name: "Maple Court", isAdmin: false },
    ]);
    expect(await getBuilding(db, (await accessBuilding(db, EDITOR, otherBuildingId)) as BuildingAccess)).toMatchObject({
      projects: [{ budgets: [{ id: elmId }] }],
    });
  });
});

describe("members", () => {
  it("lists members by email", async () => {
    const { budgetId, admin } = await seedShared();
    await addMember(budgetId, OTHER, "viewer");
    expect(await listMembers(db, admin)).toEqual([
      { userId: EDITOR, email: "editor@example.com", role: "editor" },
      { userId: VIEWER, email: "viewer@example.com", role: "viewer" },
      { userId: OTHER, email: null, role: "viewer" },
    ]);
  });

  it("changes a role, and the drafts stay when an editor becomes a viewer", async () => {
    const { budgetId, admin, editorDraftId } = await seedShared();
    await setMemberRole(db, admin, EDITOR, "viewer");
    await setMemberRole(db, admin, VIEWER, "editor");
    expect(await accessBudget(db, EDITOR, budgetId)).toMatchObject({ role: "viewer" });
    expect(await accessBudget(db, VIEWER, budgetId)).toMatchObject({ role: "editor" });
    expect(await accessDraft(db, EDITOR, budgetId, editorDraftId)).toBeNull();
    expect(publisherOfDraft(await draftAs(ADMIN, budgetId, editorDraftId))).not.toBeNull();
  });

  it("removes a member, and their drafts stay", async () => {
    const { buildingId, budgetId, admin, editor, editorDraftId } = await seedShared();
    await removeMember(db, admin, EDITOR);
    expect(await accessBudget(db, EDITOR, budgetId)).toBeNull();
    expect(await accessBuilding(db, EDITOR, buildingId)).toBeNull();
    expect(await listDrafts(db, editor)).toMatchObject([{ id: editorDraftId, author: "editor@example.com" }, {}]);
  });

  it("changes only members of the granted budget", async () => {
    const { project, budgetId } = await seedShared();
    const { budgetId: roofId } = await createBudget(db, project, "New roof", null);
    const roof = adminOfBudget(await budgetAs(ADMIN, roofId)) as BudgetAdmin;
    await setMemberRole(db, roof, EDITOR, "viewer");
    await removeMember(db, roof, VIEWER);
    await setMemberRole(db, roof, "not-a-uuid", "viewer");
    await removeMember(db, roof, "not-a-uuid");
    expect(await accessBudget(db, EDITOR, budgetId)).toMatchObject({ role: "editor" });
    expect(await accessBudget(db, VIEWER, budgetId)).toMatchObject({ role: "viewer" });
  });
});

const NOW = new Date("2026-11-01T00:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("invites", () => {
  it("adds a member with the invite's role, once", async () => {
    const { budgetId, admin } = await seed();
    const token = await createInvite(db, admin, "editor", NOW);
    expect(await peekInvite(db, EDITOR, token, NOW)).toEqual({ status: "valid", budgetId, budgetName: "Base case", role: "editor" });
    expect(await accessBudget(db, EDITOR, budgetId)).toBeNull();
    expect(await acceptInvite(db, EDITOR, token, NOW)).toEqual({ status: "joined", budgetId });
    expect(await accessBudget(db, EDITOR, budgetId)).toMatchObject({ role: "editor" });
    expect(await acceptInvite(db, VIEWER, token, NOW)).toEqual({ status: "used" });
    expect(await peekInvite(db, VIEWER, token, NOW)).toEqual({ status: "used" });
    expect(await accessBudget(db, VIEWER, budgetId)).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const { admin } = await seed();
    const token = await createInvite(db, admin, "viewer", NOW);
    const [row] = await db.select().from(tables.budgetInvite);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row).toMatchObject({ role: "viewer", createdBy: ADMIN, expiresAt: at(WEEK_MS), acceptedBy: null, acceptedAt: null });
    expect(row?.tokenHash).not.toContain(token);
  });

  it.each([
    { name: "just before 7 days", ms: WEEK_MS - 1, want: "joined" },
    { name: "at 7 days", ms: WEEK_MS, want: "expired" },
  ])("accepts or expires $name", async ({ ms, want }) => {
    const { admin } = await seed();
    const token = await createInvite(db, admin, "viewer", NOW);
    expect(await acceptInvite(db, VIEWER, token, at(ms))).toMatchObject({ status: want });
  });

  it("refuses a wrong token or a revoked invite", async () => {
    const { admin } = await seed();
    const token = await createInvite(db, admin, "viewer", NOW);
    expect(await acceptInvite(db, VIEWER, `${token}x`, NOW)).toEqual({ status: "invalid" });
    const [invite] = await listInvites(db, admin, NOW);
    await revokeInvite(db, admin, invite?.id as string);
    expect(await acceptInvite(db, VIEWER, token, NOW)).toEqual({ status: "invalid" });
    expect(await peekInvite(db, VIEWER, token, NOW)).toEqual({ status: "invalid" });
  });

  it("opens the budget for an account that can already reach it, and leaves the link unused", async () => {
    const { budgetId, admin } = await seedShared();
    const token = await createInvite(db, admin, "editor", NOW);
    expect(await acceptInvite(db, VIEWER, token, NOW)).toEqual({ status: "open", budgetId });
    expect(await acceptInvite(db, ADMIN, token, NOW)).toEqual({ status: "open", budgetId });
    expect(await peekInvite(db, ADMIN, token, NOW)).toEqual({ status: "open", budgetId });
    expect(await accessBudget(db, VIEWER, budgetId)).toMatchObject({ role: "viewer" });
    expect(await listMembers(db, admin)).toHaveLength(2);
    expect(await acceptInvite(db, OTHER, token, NOW)).toEqual({ status: "joined", budgetId });
  });

  it("lists unused invites that have not expired, newest first", async () => {
    const { admin } = await seed();
    const usedToken = await createInvite(db, admin, "viewer", NOW);
    await acceptInvite(db, VIEWER, usedToken, NOW);
    await createInvite(db, admin, "viewer", at(-WEEK_MS));
    await createInvite(db, admin, "viewer", NOW);
    await createInvite(db, admin, "editor", at(1000));
    expect(await listInvites(db, admin, NOW)).toEqual([
      { id: expect.any(String), role: "editor", expiresAt: at(WEEK_MS + 1000) },
      { id: expect.any(String), role: "viewer", expiresAt: at(WEEK_MS) },
    ]);
  });

  it("revokes only unused invites of the granted budget", async () => {
    const { project, admin } = await seed();
    const usedToken = await createInvite(db, admin, "viewer", NOW);
    await acceptInvite(db, VIEWER, usedToken, NOW);
    await createInvite(db, admin, "editor", NOW);
    const { budgetId: roofId } = await createBudget(db, project, "New roof", null);
    const roof = adminOfBudget(await budgetAs(ADMIN, roofId)) as BudgetAdmin;
    const invites = await db.select({ id: tables.budgetInvite.id }).from(tables.budgetInvite);
    for (const { id } of invites) {
      await revokeInvite(db, roof, id);
    }
    await revokeInvite(db, admin, "not-a-uuid");
    expect(await db.$count(tables.budgetInvite)).toBe(2);
    for (const { id } of invites) {
      await revokeInvite(db, admin, id);
    }
    expect(await db.select({ acceptedBy: tables.budgetInvite.acceptedBy }).from(tables.budgetInvite)).toEqual([{ acceptedBy: VIEWER }]);
  });
});

type Seeded = Awaited<ReturnType<typeof seed>>;

describe("rename", () => {
  it.each([
    {
      what: "building",
      rename: (s: Seeded) => renameBuilding(db, s.building, "Elm House"),
      read: async (s: Seeded) => (await getBuilding(db, (await accessBuilding(db, ADMIN, s.buildingId)) as BuildingAccess)).name,
    },
    {
      what: "project",
      rename: (s: Seeded) => renameProject(db, s.project, "Elm House"),
      read: async (s: Seeded) => (await getBudget(db, s.budget)).project.name,
    },
    {
      what: "budget",
      rename: (s: Seeded) => renameBudget(db, s.admin, "Elm House"),
      read: async (s: Seeded) => (await getBudget(db, s.budget)).name,
    },
    {
      what: "draft",
      rename: (s: Seeded) => renameDraft(db, s.author, "Elm House"),
      read: async (s: Seeded) => (await getDraft(db, s.draft)).name,
    },
  ])("renames a $what", async ({ rename, read }) => {
    const seeded = await seed();
    await rename(seeded);
    expect(await read(seeded)).toBe("Elm House");
  });

  it("keeps a draft's revision, so an open editor can still save", async () => {
    const { draft, author } = await seed();
    await renameDraft(db, author, "New roof");
    expect(await saveDraft(db, author, 0, DEFAULT_BUDGET)).toEqual({ status: "saved", revision: 1 });
    expect(await getDraft(db, draft)).toMatchObject({ name: "New roof", content: DEFAULT_BUDGET });
  });
});

// The shared budget holds a version, the editor's draft, two members, and an invite. Its sibling budget, a second
// project, and a second building show what each delete leaves alone.
const seedTree = async () => {
  const shared = await seedShared();
  await publish(shared.draft);
  await createInvite(db, shared.admin, "editor", NOW);
  const { budgetId: roofId } = await createBudget(db, shared.project, "New roof", null);
  await addMember(roofId, EDITOR, "viewer");
  const nextYear = (await adminOfProject(db, ADMIN, await createProject(db, shared.building, "FY2028"))) as ProjectAdmin;
  const { budgetId: nextYearId } = await createBudget(db, nextYear, "Base case", null);
  await addMember(nextYearId, OTHER, "viewer");
  const elm = (await adminOfBuilding(db, ADMIN, await createBuilding(db, ADMIN, "Elm House"))) as BuildingAdmin;
  await createBudget(db, (await adminOfProject(db, ADMIN, await createProject(db, elm, "FY2027"))) as ProjectAdmin, "Base case", null);
  return shared;
};

type Tree = Awaited<ReturnType<typeof seedTree>>;

const countRows = async () => ({
  buildings: await db.$count(tables.building),
  projects: await db.$count(tables.project),
  budgets: await db.$count(tables.budget),
  drafts: await db.$count(tables.budgetDraft),
  versions: await db.$count(tables.budgetVersion),
  members: await db.$count(tables.budgetMember),
  invites: await db.$count(tables.budgetInvite),
});

const TREE_ROWS = { buildings: 2, projects: 3, budgets: 4, drafts: 4, versions: 1, members: 4, invites: 1 };

const EDITOR_MEMBER = { userId: EDITOR, email: "editor@example.com" };
const VIEWER_MEMBER = { userId: VIEWER, email: "viewer@example.com" };

const DELETES = [
  {
    what: "budget",
    name: "Base case",
    impact: (t: Tree) => budgetImpact(db, t.admin),
    remove: (t: Tree, typed: string) => deleteBudget(db, t.admin, typed),
    removes: { budgets: 1, drafts: 1, versions: 1, members: [EDITOR_MEMBER, VIEWER_MEMBER] },
    left: { buildings: 2, projects: 3, budgets: 3, drafts: 3, versions: 0, members: 2, invites: 0 },
  },
  {
    what: "project",
    name: "FY2027",
    impact: (t: Tree) => projectImpact(db, t.project),
    remove: (t: Tree, typed: string) => deleteProject(db, t.project, typed),
    // The editor is a member of both budgets in the project, and is listed once.
    removes: { budgets: 2, drafts: 2, versions: 1, members: [EDITOR_MEMBER, VIEWER_MEMBER] },
    left: { buildings: 2, projects: 2, budgets: 2, drafts: 2, versions: 0, members: 1, invites: 0 },
  },
  {
    what: "building",
    name: "Maple Court",
    impact: (t: Tree) => buildingImpact(db, t.building),
    remove: (t: Tree, typed: string) => deleteBuilding(db, t.building, typed),
    removes: { budgets: 3, drafts: 3, versions: 1, members: [EDITOR_MEMBER, VIEWER_MEMBER, { userId: OTHER, email: null }] },
    left: { buildings: 1, projects: 1, budgets: 1, drafts: 1, versions: 0, members: 0, invites: 0 },
  },
];

describe("delete", () => {
  it.each(DELETES)("shows what deleting a $what removes", async ({ impact, removes }) => {
    expect(await impact(await seedTree())).toEqual(removes);
  });

  it.each(DELETES)("deletes a $what and everything inside it", async ({ name, remove, left }) => {
    const tree = await seedTree();
    expect(await countRows()).toEqual(TREE_ROWS);
    expect(await remove(tree, name)).toBe(true);
    expect(await countRows()).toEqual(left);
    for (const userId of [ADMIN, EDITOR, VIEWER]) {
      expect(await accessBudget(db, userId, tree.budgetId)).toBeNull();
      expect(await accessDraft(db, userId, tree.budgetId, tree.editorDraftId)).toBeNull();
    }
  });

  it.each(DELETES.flatMap((scope) => [`${scope.name}x`, scope.name.toLowerCase()].map((typed) => ({ ...scope, typed }))))(
    "refuses to delete a $what when $typed is typed",
    async ({ remove, typed }) => {
      const tree = await seedTree();
      expect(await remove(tree, typed)).toBe(false);
      expect(await countRows()).toEqual(TREE_ROWS);
    },
  );
});

describe("schema", () => {
  // Catches a schema change that was not followed by `npm run db:generate`.
  it.each([
    tables.building,
    tables.project,
    tables.budget,
    tables.budgetDraft,
    tables.budgetVersion,
    tables.budgetMember,
    tables.budgetInvite,
  ])("matches the generated migrations", async (table) => {
    const migrations = readdirSync("drizzle")
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(`drizzle/${file}`, "utf8"))
      .join("\n");
    const { name, foreignKeys, indexes } = getTableConfig(table);
    for (const key of foreignKeys) {
      expect(migrations).toContain(`ADD CONSTRAINT "${key.getName()}"`);
    }
    for (const index of indexes) {
      const columns = index.config.columns.map((column) => `"${(column as { name: string }).name}"`).join(", ");
      expect(migrations).toContain(`ON "${name}" USING btree (${columns})`);
    }
  });
});
