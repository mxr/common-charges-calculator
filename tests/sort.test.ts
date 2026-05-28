import { describe, expect, it } from "vitest";
import {
  applyOrder,
  compareExpenses,
  compareOwners,
  compareUnits,
  compareUnitTypes,
  deriveOrder,
  nextSortDir,
  parseSortParam,
  passesTypeFilter,
  passesUnitFilter,
  serializeSortParam,
} from "../lib/sort";
import type { Expense, Owner, Unit, UnitClassification, UnitType } from "../lib/types";

const u = (id: string, label: string, type: string, ci: number, ownerId = ""): Unit => ({ id, label, type, commonInterest: ci, ownerId });
const o = (id: string, name: string, currentMonthly = 0): Owner => ({ id, name, excluded: false, currentMonthly });
const t = (name: string, classification: UnitClassification = "primary"): UnitType => ({ name, classification });
const e = (id: string, name: string, amount: number, policyId = "p"): Expense => ({ id, name, amount, policyId, category: "c" });

describe("compareUnits", () => {
  it("natural-sorts labels so S2 precedes S10", () => {
    const units = [u("a", "S10", "x", 1), u("b", "S2", "x", 1), u("c", "S1", "x", 1)];
    const sorted = [...units].sort((a, b) => compareUnits(a, b, "label", "asc"));
    expect(sorted.map((unit) => unit.label)).toEqual(["S1", "S2", "S10"]);
  });

  it("sorts label descending", () => {
    const units = [u("a", "S1", "x", 1), u("b", "S10", "x", 1), u("c", "S2", "x", 1)];
    const sorted = [...units].sort((a, b) => compareUnits(a, b, "label", "desc"));
    expect(sorted.map((unit) => unit.label)).toEqual(["S10", "S2", "S1"]);
  });

  it("sorts by common interest numerically", () => {
    const units = [u("a", "x", "t", 3.5), u("b", "y", "t", 0.2), u("c", "z", "t", 10)];
    const sorted = [...units].sort((a, b) => compareUnits(a, b, "ci", "asc"));
    expect(sorted.map((unit) => unit.commonInterest)).toEqual([0.2, 3.5, 10]);
  });
});

describe("compareOwners / compareUnitTypes / compareExpenses", () => {
  it("compareOwners by name and currentMonthly", () => {
    const owners = [o("1", "Carol", 200), o("2", "Alice", 100), o("3", "Bob", 300)];
    expect([...owners].sort((a, b) => compareOwners(a, b, "name", "asc")).map((x) => x.name)).toEqual(["Alice", "Bob", "Carol"]);
    expect([...owners].sort((a, b) => compareOwners(a, b, "currentMonthly", "desc")).map((x) => x.name)).toEqual(["Bob", "Carol", "Alice"]);
  });

  it("compareUnitTypes by name and classification", () => {
    const types = [t("Storage", "ancillary"), t("Residential"), t("Commercial")];
    expect([...types].sort((a, b) => compareUnitTypes(a, b, "name", "asc")).map((x) => x.name)).toEqual([
      "Commercial",
      "Residential",
      "Storage",
    ]);
    const byClass = [...types].sort((a, b) => compareUnitTypes(a, b, "classification", "asc")).map((x) => x.classification);
    expect(byClass).toEqual(["ancillary", "primary", "primary"]);
  });

  it("compareExpenses by amount and split (policy name)", () => {
    const expenses = [e("1", "Insurance", 500, "pA"), e("2", "Water", 100, "pB"), e("3", "Heat", 200, "pA")];
    const policyName = new Map([
      ["pA", "Zeta"],
      ["pB", "Alpha"],
    ]);
    expect([...expenses].sort((a, b) => compareExpenses(a, b, "amount", "asc", policyName)).map((x) => x.amount)).toEqual([100, 200, 500]);
    expect([...expenses].sort((a, b) => compareExpenses(a, b, "split", "asc", policyName)).map((x) => x.name)).toEqual([
      "Water",
      "Insurance",
      "Heat",
    ]);
  });
});

describe("parseSortParam", () => {
  it("returns empty result for empty string", () => {
    expect(parseSortParam("")).toEqual({ owner: null, unit: null, unitType: null, expenses: {} });
  });

  it("parses owner, unit, unitType, and expense tokens", () => {
    const raw = "o:name:asc,u:ci:desc,ut:classification:asc,e:Utilities:amount:desc";
    expect(parseSortParam(raw)).toEqual({
      owner: { key: "name", dir: "asc" },
      unit: { key: "ci", dir: "desc" },
      unitType: { key: "classification", dir: "asc" },
      expenses: { Utilities: { key: "amount", dir: "desc" } },
    });
  });

  it("ignores unknown keys and bad directions", () => {
    const raw = "u:owner:asc,u:label:sideways,o:nope:asc";
    expect(parseSortParam(raw)).toEqual({ owner: null, unit: null, unitType: null, expenses: {} });
  });

  it("decodes encoded category names", () => {
    const raw = `e:${encodeURIComponent("Misc, etc")}:name:asc`;
    expect(parseSortParam(raw).expenses).toEqual({ "Misc, etc": { key: "name", dir: "asc" } });
  });

  it("round-trips via serializeSortParam", () => {
    const raw = "o:name:asc,u:label:desc,ut:name:asc,e:General:amount:desc";
    const parsed = parseSortParam(raw);
    expect(serializeSortParam(parsed.owner, parsed.unit, parsed.unitType, parsed.expenses)).toBe(raw);
  });
});

describe("passesUnitFilter", () => {
  const classByType = new Map<string, UnitClassification>([
    ["R", "primary"],
    ["S", "ancillary"],
  ]);

  it("passes all when filters empty", () => {
    expect(passesUnitFilter(u("u", "x", "R", 1), classByType, "all", new Set())).toBe(true);
    expect(passesUnitFilter(u("u", "x", "S", 1), classByType, "all", new Set())).toBe(true);
  });

  it("restricts by classification", () => {
    expect(passesUnitFilter(u("u", "x", "R", 1), classByType, "primary", new Set())).toBe(true);
    expect(passesUnitFilter(u("u", "x", "S", 1), classByType, "primary", new Set())).toBe(false);
  });

  it("restricts by type-name set (multiselect)", () => {
    expect(passesUnitFilter(u("u", "x", "R", 1), classByType, "all", new Set(["R"]))).toBe(true);
    expect(passesUnitFilter(u("u", "x", "S", 1), classByType, "all", new Set(["R"]))).toBe(false);
    expect(passesUnitFilter(u("u", "x", "S", 1), classByType, "all", new Set(["R", "S"]))).toBe(true);
  });

  it("rejects unknown type names when classification filter is active", () => {
    expect(passesUnitFilter(u("u", "x", "ghost", 1), classByType, "primary", new Set())).toBe(false);
    expect(passesUnitFilter(u("u", "x", "ghost", 1), classByType, "all", new Set())).toBe(true);
  });
});

describe("passesTypeFilter", () => {
  it("passes everything when filters empty", () => {
    expect(passesTypeFilter(t("R"), "all", new Set())).toBe(true);
    expect(passesTypeFilter(t("S", "ancillary"), "all", new Set())).toBe(true);
  });

  it("restricts by classification", () => {
    expect(passesTypeFilter(t("R"), "primary", new Set())).toBe(true);
    expect(passesTypeFilter(t("S", "ancillary"), "primary", new Set())).toBe(false);
  });

  it("restricts by name set", () => {
    expect(passesTypeFilter(t("R"), "all", new Set(["R"]))).toBe(true);
    expect(passesTypeFilter(t("S", "ancillary"), "all", new Set(["R"]))).toBe(false);
  });
});

describe("applyOrder / nextSortDir / deriveOrder", () => {
  it("applyOrder reorders by saved id list, leaving unknowns at the end", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(applyOrder(items, ["c", "a"], (item) => item.id).map((item) => item.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("applyOrder returns a shallow copy when order is empty", () => {
    const items = [{ id: "a" }, { id: "b" }];
    const out = applyOrder(items, [], (item) => item.id);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it("nextSortDir cycles asc -> desc -> off across the same key", () => {
    expect(nextSortDir(undefined, "name")).toBe("asc");
    expect(nextSortDir({ key: "name", dir: "asc" }, "name")).toBe("desc");
    expect(nextSortDir({ key: "name", dir: "desc" }, "name")).toBe(null);
    expect(nextSortDir({ key: "name", dir: "desc" }, "amount")).toBe("asc");
  });

  it("deriveOrder cascades a new sort on top of the prior order", () => {
    const items = [
      { id: "1", a: 1, b: 2 },
      { id: "2", a: 1, b: 1 },
      { id: "3", a: 2, b: 1 },
    ];
    const byB = deriveOrder(
      items,
      [],
      (item) => item.id,
      (x, y) => x.b - y.b,
    );
    const byA = deriveOrder(
      items,
      byB,
      (item) => item.id,
      (x, y) => x.a - y.a,
    );
    expect(byA).toEqual(["2", "1", "3"]);
  });
});
