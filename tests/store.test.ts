import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, EMPTY_BUDGET } from "../lib/budget";
import { diffBudgets } from "../lib/diff";
import { accessBudget, accessDraft, adminOfBuilding, adminOfProject, authorOfDraft } from "../lib/server/access";
import * as tables from "../lib/server/schema";
import {
  createBudget,
  createBuilding,
  createDraft,
  createDraftFromVersion,
  createProject,
  deleteDraft,
  FIRST_DRAFT_NAME,
  getBudget,
  getBuilding,
  getChangelog,
  getDraft,
  getVersion,
  listBuildings,
  parseName,
  parseNote,
  parseVersionNumber,
  publishDraft,
  saveDraft,
} from "../lib/server/store";
import type { BudgetAccess, BuildingAdmin, DraftAccess, DraftAuthor, ProjectAdmin } from "../lib/server/access";
import type { Db } from "../lib/server/login";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

let db: Db;

beforeEach(async () => {
  const pglite = drizzle(new PGlite());
  await migrate(pglite, { migrationsFolder: "drizzle" });
  // Neon Auth creates this table, outside the migrations.
  await pglite.execute(sql`create schema neon_auth`);
  await pglite.execute(sql`create table neon_auth."user" (id uuid primary key, email text not null)`);
  await pglite.execute(sql`insert into neon_auth."user" values (${ADMIN}, 'admin@example.com')`);
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
  return { buildingId, building, projectId, project, budgetId, budget, draftId, draft, author: authorOfDraft(draft) as DraftAuthor };
};

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
    expect(await accessBudget(db, ADMIN, budgetId)).toEqual({ userId: ADMIN, budgetId });
    expect(await accessDraft(db, ADMIN, budgetId, draftId)).toEqual({ userId: ADMIN, budgetId, draftId, isAuthor: true });
  });

  it("refuses another account", async () => {
    const { buildingId, projectId, budgetId, draftId } = await seed();
    expect(await adminOfBuilding(db, OTHER, buildingId)).toBeNull();
    expect(await adminOfProject(db, OTHER, projectId)).toBeNull();
    expect(await accessBudget(db, OTHER, budgetId)).toBeNull();
    expect(await accessDraft(db, OTHER, budgetId, draftId)).toBeNull();
  });

  it.each(["not-a-uuid", MISSING])("treats %s as not found", async (id) => {
    const { budgetId } = await seed();
    expect(await adminOfBuilding(db, ADMIN, id)).toBeNull();
    expect(await adminOfProject(db, ADMIN, id)).toBeNull();
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
  });
});

describe("buildings", () => {
  it("lists only the account's buildings, by name", async () => {
    const maple = await createBuilding(db, ADMIN, "Maple Court");
    await createBuilding(db, OTHER, "Elm House");
    const birch = await createBuilding(db, ADMIN, "Birch Lofts");
    expect(await listBuildings(db, ADMIN)).toEqual([
      { id: birch, name: "Birch Lofts" },
      { id: maple, name: "Maple Court" },
    ]);
  });

  it("shows projects with their budgets by name, including empty projects", async () => {
    const { building, project, projectId, budgetId } = await seed();
    const { budgetId: roofId } = await createBudget(db, project, "New roof", null);
    const { budgetId: auditId } = await createBudget(db, project, "Audit", null);
    const emptyId = await createProject(db, building, "FY2028");
    expect(await getBuilding(db, building)).toEqual({
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
    const { budget, draft, author, draftId, buildingId, projectId } = await seed();
    expect(await getBudget(db, budget)).toMatchObject({
      name: "Base case",
      building: { id: buildingId, name: "Maple Court" },
      project: { id: projectId, name: "FY2027" },
      drafts: [{ id: draftId, name: FIRST_DRAFT_NAME }],
    });
    expect(await getDraft(db, author)).toEqual({ name: FIRST_DRAFT_NAME, baseVersion: 0, revision: 0, content: EMPTY_BUDGET });
    expect(await getBudget(db, draft)).toEqual(await getBudget(db, budget));
  });

  it("copies the newest draft of another budget", async () => {
    const { building, budget, author } = await seed();
    const olderId = await createDraft(db, budget, "Older", EMPTY_BUDGET);
    await db
      .update(tables.budgetDraft)
      .set({ updatedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(tables.budgetDraft.id, olderId));
    await saveDraft(db, author, 0, DEFAULT_BUDGET);
    const nextYear = (await adminOfProject(db, ADMIN, await createProject(db, building, "FY2028"))) as ProjectAdmin;
    const { budgetId, draftId } = await createBudget(db, nextYear, "Base case", budget);
    const copy = (await accessDraft(db, ADMIN, budgetId, draftId)) as DraftAccess;
    expect((await getDraft(db, authorOfDraft(copy) as DraftAuthor)).content).toEqual(DEFAULT_BUDGET);
  });

  it("starts empty when the copied budget has no drafts", async () => {
    const { project, budget, draft, author } = await seed();
    await deleteDraft(db, draft);
    const { budgetId, draftId } = await createBudget(db, project, "New roof", budget);
    const copy = (await accessDraft(db, ADMIN, budgetId, draftId)) as DraftAccess;
    expect((await getDraft(db, authorOfDraft(copy) as DraftAuthor)).content).toEqual(EMPTY_BUDGET);
    expect(author.draftId).not.toBe(draftId);
  });
});

describe("drafts", () => {
  it("adds a draft with the given content, listed newest first", async () => {
    const { budget, budgetId, draftId } = await seed();
    const savedId = await createDraft(db, budget, "From the calculator", DEFAULT_BUDGET);
    await db
      .update(tables.budgetDraft)
      .set({ updatedAt: new Date("2026-11-01T00:00:00Z") })
      .where(eq(tables.budgetDraft.id, draftId));
    const saved = (await accessDraft(db, ADMIN, budgetId, savedId)) as DraftAccess;
    expect(await getDraft(db, authorOfDraft(saved) as DraftAuthor)).toEqual({
      name: "From the calculator",
      baseVersion: 0,
      revision: 0,
      content: DEFAULT_BUDGET,
    });
    expect((await getBudget(db, budget)).drafts.map((draft) => draft.id)).toEqual([savedId, draftId]);
  });

  it("saves with the current revision and refuses an old one", async () => {
    const { author } = await seed();
    expect(await saveDraft(db, author, 0, DEFAULT_BUDGET)).toEqual({ status: "saved", revision: 1 });
    expect(await saveDraft(db, author, 0, EMPTY_BUDGET)).toEqual({ status: "stale" });
    expect(await getDraft(db, author)).toMatchObject({ revision: 1, content: DEFAULT_BUDGET });
    expect(await saveDraft(db, author, 1, EMPTY_BUDGET)).toEqual({ status: "saved", revision: 2 });
  });

  it("normalizes stored content on read", async () => {
    const { author } = await seed();
    await db.update(tables.budgetDraft).set({ content: { owners: [{ id: "o", name: "Ann" }] } as never });
    expect((await getDraft(db, author)).content.owners).toEqual([{ id: "o", name: "Ann", isBoard: false, currentMonthly: 0 }]);
  });

  it("deletes a draft", async () => {
    const { budget, draft } = await seed();
    await deleteDraft(db, draft);
    expect((await getBudget(db, budget)).drafts).toEqual([]);
  });
});

// Publishing runs in a transaction, which PGlite supports like the WebSocket driver does.
const publish = (draft: DraftAccess, revision = 0, confirmedLatest = 0, note = "") =>
  publishDraft(db, draft, { revision, note, confirmedLatest });

describe("versions", () => {
  it("publishes a draft as version 1 and removes the draft", async () => {
    const { budget, draft, author } = await seed();
    await saveDraft(db, author, 0, DEFAULT_BUDGET);
    expect(await publish(draft, 1, 0, "Board approved")).toEqual({ status: "published", number: 1 });
    expect(await getBudget(db, budget)).toMatchObject({ latestVersion: 1, drafts: [] });
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
    const { budget, draft } = await seed();
    await publish(draft);
    const restoreId = (await createDraftFromVersion(db, budget, "Restore", 1)) as string;
    const restore = (await accessDraft(db, ADMIN, budget.budgetId, restoreId)) as DraftAccess;
    expect((await getBudget(db, budget)).drafts).toMatchObject([{ id: restoreId, baseVersion: 1, revision: 0 }]);
    expect(await publish(restore)).toEqual({ status: "published", number: 2 });
    expect(await getVersion(db, budget, 2)).toMatchObject({ number: 2, basedOn: 1, content: EMPTY_BUDGET });
  });

  it("asks to review the latest version when another publish came first", async () => {
    const { budget, draft, author } = await seed();
    const otherId = await createDraft(db, budget, "Other", EMPTY_BUDGET);
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
    await deleteDraft(db, draft);
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
    const other = (await accessBudget(db, ADMIN, otherId)) as BudgetAccess;
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
    const { budget, draft } = await seed();
    await publish(draft, 0, 0, "First");
    const secondId = await createDraft(db, budget, "Second", DEFAULT_BUDGET);
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
    const { building, budget, draft } = await seed();
    await publish(draft);
    const restoreId = (await createDraftFromVersion(db, budget, "Restore", 1)) as string;
    const restore = (await accessDraft(db, ADMIN, budget.budgetId, restoreId)) as DraftAccess;
    await saveDraft(db, authorOfDraft(restore) as DraftAuthor, 0, DEFAULT_BUDGET);
    const nextYear = (await adminOfProject(db, ADMIN, await createProject(db, building, "FY2028"))) as ProjectAdmin;
    const { budgetId, draftId } = await createBudget(db, nextYear, "Base case", budget);
    const copy = (await accessDraft(db, ADMIN, budgetId, draftId)) as DraftAccess;
    expect(await getDraft(db, authorOfDraft(copy) as DraftAuthor)).toMatchObject({ baseVersion: 0, content: EMPTY_BUDGET });
  });
});

describe("schema", () => {
  // Catches a schema change that was not followed by `npm run db:generate`.
  it.each([tables.building, tables.project, tables.budget, tables.budgetDraft, tables.budgetVersion])(
    "matches the generated migrations",
    async (table) => {
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
    },
  );
});
