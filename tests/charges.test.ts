import { compressToEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vitest";
import { computeCharges } from "../lib/allocate";
import { DEFAULT_BUDGET, makeId, normalizeBudget, validateBudget } from "../lib/budget";
import { formatCurrency, formatPercent, toNumber } from "../lib/format";
import { parseOwnerLines, parseUnitLines } from "../lib/parse";
import { exportBudgetJson, parseBudgetJson, parseBudgetUrl, serializeBudgetUrl } from "../lib/serialize";
import type { Budget } from "../lib/types";

const owner = (id: string, excluded = false): Budget["owners"][number] => ({ id, name: id, excluded, currentMonthly: 0 });

const unit = (id: string, type: string, commonInterest: number, ownerId: string): Budget["units"][number] => ({
  id,
  label: id,
  type,
  commonInterest,
  ownerId,
});

const makeBudget = (overrides: Partial<Budget>): Budget => ({
  owners: [owner("o1")],
  units: [unit("u1", "residential", 100, "o1")],
  unitTypes: ["residential", "commercial"],
  categories: ["general"],
  policies: [{ id: "p", name: "standard", rules: [{ unitTypes: ["residential", "commercial"], weight: 100, method: "common_interest" }] }],
  expenses: [{ id: "e", name: "exp", category: "general", amount: 100, policyId: "p" }],
  adjustments: { inflationPct: 0, reservePct: 0 },
  ...overrides,
});

const chargeFor = (budget: Budget, unitId: string) => {
  const result = computeCharges(budget);
  const found = result.perUnit.find((entry) => entry.unitId === unitId);
  if (!found) {
    throw new Error(`no charge for ${unitId}`);
  }
  return found;
};

describe("computeCharges allocation methods", () => {
  it("splits by common interest", () => {
    const budget = makeBudget({
      units: [unit("u1", "residential", 30, "o1"), unit("u2", "residential", 70, "o1")],
    });
    expect(chargeFor(budget, "u1").total).toBeCloseTo(30);
    expect(chargeFor(budget, "u2").total).toBeCloseTo(70);
  });

  it("splits equally per unit regardless of common interest", () => {
    const budget = makeBudget({
      units: [unit("u1", "residential", 10, "o1"), unit("u2", "residential", 80, "o1"), unit("u3", "residential", 10, "o1")],
      expenses: [{ id: "e", name: "fiber", category: "general", amount: 90, policyId: "p" }],
      policies: [{ id: "p", name: "per-unit", rules: [{ unitTypes: ["residential"], weight: 100, method: "equal_per_unit" }] }],
    });
    for (const id of ["u1", "u2", "u3"]) {
      expect(chargeFor(budget, id).total).toBeCloseTo(30);
    }
  });

  it("falls back to equal split when eligible common interest is zero", () => {
    const budget = makeBudget({
      units: [unit("u1", "residential", 0, "o1"), unit("u2", "residential", 0, "o1")],
    });
    expect(chargeFor(budget, "u1").total).toBeCloseTo(50);
    expect(chargeFor(budget, "u2").total).toBeCloseTo(50);
  });
});

describe("computeCharges policies", () => {
  it("excludes commercial units (elevator)", () => {
    const budget = makeBudget({
      units: [unit("u1", "residential", 60, "o1"), unit("u2", "commercial", 40, "o1")],
      policies: [{ id: "p", name: "no-commercial", rules: [{ unitTypes: ["residential"], weight: 100, method: "common_interest" }] }],
    });
    expect(chargeFor(budget, "u1").total).toBeCloseTo(100);
    expect(chargeFor(budget, "u2").total).toBeCloseTo(0);
  });

  it("applies a multi-rule 5/95 super split", () => {
    const budget = makeBudget({
      units: [unit("comm", "commercial", 20, "o1"), unit("res1", "residential", 50, "o1"), unit("res2", "residential", 30, "o1")],
      expenses: [{ id: "e", name: "super", category: "general", amount: 1000, policyId: "p" }],
      policies: [
        {
          id: "p",
          name: "super",
          rules: [
            { unitTypes: ["commercial"], weight: 5, method: "common_interest" },
            { unitTypes: ["residential"], weight: 95, method: "common_interest" },
          ],
        },
      ],
    });
    expect(chargeFor(budget, "comm").total).toBeCloseTo(50);
    expect(chargeFor(budget, "res1").total).toBeCloseTo(950 * (50 / 80));
    expect(chargeFor(budget, "res2").total).toBeCloseTo(950 * (30 / 80));
  });
});

describe("computeCharges excluded owners", () => {
  it("drops excluded units so the rest absorb the cost", () => {
    const budget = makeBudget({
      owners: [owner("o1"), owner("board", true)],
      units: [unit("u1", "residential", 50, "o1"), unit("uboard", "residential", 50, "board")],
    });
    expect(chargeFor(budget, "u1").total).toBeCloseTo(100);
    expect(chargeFor(budget, "uboard").total).toBeCloseTo(0);
    expect(chargeFor(budget, "uboard").excluded).toBe(true);
  });
});

describe("computeCharges adjustments", () => {
  it("applies inflation to the expense base", () => {
    const budget = makeBudget({ adjustments: { inflationPct: 10, reservePct: 0 } });
    expect(chargeFor(budget, "u1").base).toBeCloseTo(110);
    expect(chargeFor(budget, "u1").total).toBeCloseTo(110);
  });

  it("adds a reserve on top of the base", () => {
    const budget = makeBudget({ adjustments: { inflationPct: 0, reservePct: 10 } });
    const charge = chargeFor(budget, "u1");
    expect(charge.base).toBeCloseTo(100);
    expect(charge.reserve).toBeCloseTo(10);
    expect(charge.total).toBeCloseTo(110);
  });

  it("rebalances a per-unit-type offset onto the other units without changing the total", () => {
    const budget = makeBudget({
      units: [
        unit("c1", "commercial", 20, "o1"),
        unit("r1", "residential", 20, "o1"),
        unit("r2", "residential", 20, "o1"),
        unit("r3", "residential", 20, "o1"),
        unit("r4", "residential", 20, "o1"),
      ],
      adjustments: { inflationPct: 0, reservePct: 0, offsets: [{ unitType: "commercial", pct: -10 }] },
    });
    const result = computeCharges(budget);
    // commercial base 20 -> -10% = 18; the 2 is spread across the four residential units (equal CI)
    expect(chargeFor(budget, "c1").total).toBeCloseTo(18);
    for (const id of ["r1", "r2", "r3", "r4"]) {
      expect(chargeFor(budget, id).total).toBeCloseTo(20.5);
    }
    expect(result.totals.total).toBeCloseTo(100);
    expect(result.totals.offset).toBeCloseTo(0);
  });

  it("distributes the rebalance proportional to common interest", () => {
    const budget = makeBudget({
      units: [unit("c1", "commercial", 20, "o1"), unit("r1", "residential", 60, "o1"), unit("r2", "residential", 20, "o1")],
      adjustments: { inflationPct: 0, reservePct: 0, offsets: [{ unitType: "commercial", pct: -10 }] },
    });
    // commercial base 20 -> -2; r1 and r2 split +2 by CI 60:20 -> +1.5 and +0.5
    expect(chargeFor(budget, "r1").total).toBeCloseTo(61.5);
    expect(chargeFor(budget, "r2").total).toBeCloseTo(20.5);
  });

  it("warns when every unit type has an offset so nothing can absorb the rebalance", () => {
    const budget = makeBudget({
      units: [unit("c1", "commercial", 50, "o1"), unit("r1", "residential", 50, "o1")],
      adjustments: {
        inflationPct: 0,
        reservePct: 0,
        offsets: [
          { unitType: "commercial", pct: -10 },
          { unitType: "residential", pct: -10 },
        ],
      },
    });
    const result = computeCharges(budget);
    expect(result.warnings.some((w) => w.includes("could not be rebalanced"))).toBe(true);
  });

  it("subtracts non-common-charge income proportional to base", () => {
    const budget = makeBudget({
      units: [unit("u1", "residential", 50, "o1"), unit("u2", "commercial", 50, "o1")],
      adjustments: { inflationPct: 0, reservePct: 0, incomeOffset: 20 },
    });
    const result = computeCharges(budget);
    expect(chargeFor(budget, "u1").total).toBeCloseTo(40);
    expect(chargeFor(budget, "u2").total).toBeCloseTo(40);
    expect(result.totals.income).toBeCloseTo(-20);
    expect(result.totals.total).toBeCloseTo(80);
  });

  it("applies inflation before reserve", () => {
    const budget = makeBudget({ adjustments: { inflationPct: 10, reservePct: 10 } });
    const charge = chargeFor(budget, "u1");
    expect(charge.base).toBeCloseTo(110);
    expect(charge.reserve).toBeCloseTo(11);
    expect(charge.total).toBeCloseTo(121);
  });
});

describe("computeCharges edge cases and totals", () => {
  it("reports unallocated money when a rule has no eligible units", () => {
    const budget = makeBudget({
      policies: [{ id: "p", name: "ghost", rules: [{ unitTypes: ["penthouse"], weight: 100, method: "common_interest" }] }],
    });
    const result = computeCharges(budget);
    expect(result.unallocated).toBeCloseTo(100);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("reports unallocated money when an expense has no valid policy", () => {
    const budget = makeBudget({
      expenses: [{ id: "e", name: "orphan", category: "general", amount: 100, policyId: "missing" }],
    });
    const result = computeCharges(budget);
    expect(result.unallocated).toBeCloseTo(100);
  });

  it("handles a zero-amount expense without charging anyone", () => {
    const budget = makeBudget({
      expenses: [{ id: "e", name: "free", category: "general", amount: 0, policyId: "p" }],
    });
    expect(chargeFor(budget, "u1").total).toBeCloseTo(0);
  });

  it("aggregates per owner, per category, monthly, and grand totals", () => {
    const result = computeCharges(DEFAULT_BUDGET);
    const board = result.perOwner.find((entry) => entry.ownerId === "owner-board");
    expect(board?.total).toBeCloseTo(0);
    expect(result.totals.monthly).toBeCloseTo(result.totals.total / 12);
    const categorySum = Object.values(result.byCategory).reduce((sum, value) => sum + value, 0);
    expect(categorySum).toBeCloseTo(result.totals.base);
    const ownerSum = result.perOwner.reduce((sum, entry) => sum + entry.total, 0);
    expect(ownerSum).toBeCloseTo(result.totals.total);
  });
});

describe("validateBudget", () => {
  it("returns no warnings for the default budget", () => {
    expect(validateBudget(DEFAULT_BUDGET)).toEqual([]);
  });

  it("warns when common interests do not sum to 100", () => {
    const budget = makeBudget({ units: [unit("u1", "residential", 90, "o1")] });
    expect(validateBudget(budget).some((w) => w.includes("Common interests"))).toBe(true);
  });

  it("warns when policy weights do not sum to 100", () => {
    const budget = makeBudget({
      policies: [{ id: "p", name: "bad", rules: [{ unitTypes: [], weight: 50, method: "common_interest" }] }],
    });
    expect(validateBudget(budget).some((w) => w.includes("rule weights"))).toBe(true);
  });

  it("warns when an owner is not assigned to any unit", () => {
    const budget = makeBudget({
      owners: [owner("o1"), owner("o2")],
      units: [unit("u1", "residential", 100, "o1")],
    });
    expect(validateBudget(budget).some((w) => w.includes("not assigned to any unit"))).toBe(true);
  });

  it("warns when an expense is $0", () => {
    const budget = makeBudget({
      expenses: [{ id: "e", name: "Reserve placeholder", category: "general", amount: 0, policyId: "p" }],
    });
    expect(validateBudget(budget).some((w) => w.includes("is $0"))).toBe(true);
  });

  it("warns when a unit type or category is unused", () => {
    const budget = makeBudget({
      unitTypes: ["residential", "commercial"],
      categories: ["general", "extra"],
    });
    const warnings = validateBudget(budget);
    expect(warnings.some((w) => w.includes('Unit type "commercial" is not used'))).toBe(true);
    expect(warnings.some((w) => w.includes('Category "extra" is not used'))).toBe(true);
  });

  it("warns on missing policy and dangling owner and type references", () => {
    const budget = makeBudget({
      units: [unit("u1", "penthouse", 100, "ghost")],
      expenses: [{ id: "e", name: "exp", category: "general", amount: 100, policyId: "missing" }],
    });
    const warnings = validateBudget(budget);
    expect(warnings.some((w) => w.includes("no valid policy"))).toBe(true);
    expect(warnings.some((w) => w.includes("unknown owner"))).toBe(true);
    expect(warnings.some((w) => w.includes("unknown type"))).toBe(true);
  });
});

describe("normalizeBudget", () => {
  it("returns empty collections for non-object input", () => {
    const budget = normalizeBudget(null);
    expect(budget.owners).toEqual([]);
    expect(budget.units).toEqual([]);
    expect(budget.expenses).toEqual([]);
    expect(budget.policies).toEqual([]);
    expect(budget.adjustments).toEqual({ inflationPct: 0, reservePct: 0, offsets: [], incomeOffset: 0 });
  });

  it("coerces malformed fields and fills defaults", () => {
    const budget = normalizeBudget({
      owners: [{ name: "Alice" }],
      units: [{ commonInterest: "40", type: "residential" }],
      policies: [{ rules: [{ weight: "10", method: "bogus" }] }, { name: "Empty", rules: [] }],
      expenses: [{ amount: "500" }],
      unitTypes: ["residential", 7],
      adjustments: { inflationPct: "3", offsets: [{ unitType: "commercial", pct: "-5" }] },
    });
    expect(budget.owners[0].id).toMatch(/^owner-/);
    expect(budget.owners[0].excluded).toBe(false);
    expect(budget.units[0].commonInterest).toBe(40);
    expect(budget.policies[0].rules[0].weight).toBe(10);
    expect(budget.policies[0].rules[0].method).toBe("common_interest");
    expect(budget.policies[1].rules).toHaveLength(1);
    expect(budget.expenses[0].amount).toBe(500);
    expect(budget.unitTypes).toEqual(["residential"]);
    expect(budget.adjustments.inflationPct).toBe(3);
    expect(budget.adjustments.offsets).toEqual([{ unitType: "commercial", pct: -5 }]);
  });
});

describe("serialize round-trips", () => {
  it("round-trips the budget through a URL param", () => {
    const encoded = serializeBudgetUrl(DEFAULT_BUDGET);
    const parsed = parseBudgetUrl(encoded);
    expect(parsed).not.toBeNull();
    // ids are dropped from the URL and regenerated on load, so re-encoding is the stable
    // comparison: the packed form is deterministic and id-free, so equal output proves every
    // value and cross-reference survived the round trip.
    expect(serializeBudgetUrl(parsed as Budget)).toBe(encoded);
  });

  it("round-trips the budget through exported JSON", () => {
    const json = exportBudgetJson(DEFAULT_BUDGET);
    expect(parseBudgetJson(json)).toEqual(DEFAULT_BUDGET);
  });

  it("returns null for empty or malformed input", () => {
    expect(parseBudgetUrl(null)).toBeNull();
    expect(parseBudgetUrl("")).toBeNull();
    expect(parseBudgetUrl("!!!not-valid!!!")).toBeNull();
    expect(parseBudgetJson("not json")).toBeNull();
  });

  it("preserves orphan references and offsets through the packed encoding", () => {
    // commercial type, the "p2" policy and "ghost" owner are not in their lookup lists, so the
    // packed form stores them as string/-1 fallbacks rather than indices.
    const budget = makeBudget({
      unitTypes: ["residential"],
      categories: ["general"],
      owners: [owner("o1")],
      units: [unit("u1", "commercial", 100, "ghost")],
      policies: [{ id: "p", name: "standard", rules: [{ unitTypes: ["commercial"], weight: 100, method: "common_interest" }] }],
      expenses: [{ id: "e", name: "exp", category: "misc", amount: 100, policyId: "p2" }],
      adjustments: { inflationPct: 5, reservePct: 10, offsets: [{ unitType: "commercial", pct: -5 }], incomeOffset: 200 },
    });
    const parsed = parseBudgetUrl(serializeBudgetUrl(budget)) as Budget;
    expect(parsed.units[0].type).toBe("commercial");
    expect(parsed.units[0].ownerId).toBe("");
    expect(parsed.expenses[0].category).toBe("misc");
    expect(parsed.expenses[0].policyId).toBe("");
    expect(parsed.adjustments.offsets).toEqual([{ unitType: "commercial", pct: -5 }]);
    expect(parsed.adjustments.incomeOffset).toBe(200);
  });

  it("still parses older links that stored the full budget object", () => {
    const legacy = compressToEncodedURIComponent(JSON.stringify(DEFAULT_BUDGET));
    expect(parseBudgetUrl(legacy)).toEqual(DEFAULT_BUDGET);
  });
});

describe("formatting helpers", () => {
  it.each([
    [0, "$0.00"],
    [1234.5, "$1,234.50"],
  ])("formats %d as currency %s", (value, expected) => {
    expect(formatCurrency(value)).toBe(expected);
  });

  it.each([
    [10, "10"],
    [12.5, "12.50"],
  ])("formats %d as percent %s", (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });

  it.each([
    ["42", 42],
    ["", 0],
    ["abc", 0],
  ])("parses %s to number %d", (value, expected) => {
    expect(toNumber(value)).toBe(expected);
  });
});

describe("batch parsing", () => {
  it("parses owners with an optional current monthly amount", () => {
    const { owners, skipped } = parseOwnerLines("Alice, $1000\n\n  Bob  , 900\nCarol");
    expect(owners.map((o) => [o.name, o.currentMonthly])).toEqual([
      ["Alice", 1000],
      ["Bob", 900],
      ["Carol", 0],
    ]);
    expect(owners.every((o) => o.excluded === false)).toBe(true);
    expect(skipped).toEqual([]);
  });

  it("parses valid unit lines and skips bad ones", () => {
    const owners = [owner("owner-1"), { id: "owner-2", name: "Maple Holdings LLC", excluded: false, currentMonthly: 0 }];
    const text = [
      "1A,\tresidential ,  30% , owner-1",
      "CU1\tCOMMERCIAL\t20\tmaple holdings llc",
      "",
      "bad line",
      "P1, penthouse, 10, owner-1",
      "G1, garage, abc, owner-1",
      "S1, storage, 5, Ghost",
    ].join("\n");
    const { units, skipped } = parseUnitLines(text, ["Residential", "Commercial", "Garage", "Storage"], owners);
    expect(units.map((unit) => [unit.label, unit.type, unit.commonInterest, unit.ownerId])).toEqual([
      ["1A", "Residential", 30, "owner-1"],
      ["CU1", "Commercial", 20, "owner-2"],
    ]);
    expect(skipped.map((entry) => entry.reason)).toEqual([
      "expected: label, type, common interest, owner",
      'unknown type "penthouse"',
      'invalid common interest "abc"',
      'unknown owner "Ghost"',
    ]);
  });
});

describe("makeId", () => {
  it("produces unique prefixed ids", () => {
    const a = makeId("unit");
    const b = makeId("unit");
    expect(a.startsWith("unit-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
