import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET } from "../lib/budget";
import { diffBudgets, isUnchanged } from "../lib/diff";
import type { Budget } from "../lib/types";

const BASE: Budget = {
  owners: [
    { id: "ann", name: "Ann", isBoard: false, currentMonthly: 100 },
    { id: "ben", name: "Ben", isBoard: false, currentMonthly: 100 },
  ],
  units: [
    { id: "1a", label: "1A", type: "Residential", commonInterest: 50, ownerId: "ann", tags: [] },
    { id: "1b", label: "1B", type: "Residential", commonInterest: 50, ownerId: "ben", tags: ["hydronic"] },
  ],
  unitTypes: [{ name: "Residential", classification: "primary" }],
  categories: ["Insurance"],
  policies: [
    { id: "std", name: "Standard", note: "", rules: [{ unitTypes: ["Residential"], tags: [], weight: 100, method: "common_interest" }] },
  ],
  expenses: [{ id: "ins", name: "Insurance", category: "Insurance", amount: 2400, policyId: "std" }],
  adjustments: { inflationPct: 0, reservePct: 0, offsets: [], incomes: [] },
};

const edit = (change: (budget: Budget) => void): Budget => {
  const budget = structuredClone(BASE);
  change(budget);
  return budget;
};

describe("diffBudgets", () => {
  it("finds nothing between equal budgets, even when entries are reordered", () => {
    const diff = diffBudgets(
      BASE,
      edit((budget) => budget.owners.reverse()),
    );
    expect(diff).toEqual({ sections: [], charges: [] });
    expect(isUnchanged(diff)).toBe(true);
  });

  it.each([
    {
      name: "an owner's fields",
      change: (budget: Budget) => {
        budget.owners[0] = { id: "ann", name: "Anna", isBoard: true, currentMonthly: 150 };
      },
      want: {
        section: "Owners",
        entries: [
          {
            change: "changed",
            name: "Anna",
            fields: [
              { field: "Name", before: "Ann", after: "Anna" },
              { field: "Current $/mo", before: "$100.00", after: "$150.00" },
              { field: "Board", before: "No", after: "Yes" },
            ],
          },
        ],
      },
    },
    {
      name: "a unit type's classification",
      change: (budget: Budget) => {
        budget.unitTypes = [{ name: "Residential", classification: "ancillary" }];
      },
      want: {
        section: "Unit types",
        entries: [{ change: "changed", name: "Residential", fields: [{ field: "Classification", before: "Primary", after: "Ancillary" }] }],
      },
    },
    {
      name: "a unit's owner and tags",
      change: (budget: Budget) => {
        budget.units[0] = { id: "1a", label: "", type: "Residential", commonInterest: 50, ownerId: "gone", tags: ["corner"] };
        budget.units[1] = { id: "1b", label: "1B", type: "Residential", commonInterest: 50, ownerId: "ben", tags: [] };
      },
      want: {
        section: "Units",
        entries: [
          {
            change: "changed",
            name: "(unnamed)",
            fields: [
              { field: "Label", before: "1A", after: "" },
              { field: "Owner", before: "Ann", after: "Unassigned" },
              { field: "Tags", before: "None", after: "corner" },
            ],
          },
          { change: "changed", name: "1B", fields: [{ field: "Tags", before: "hydronic", after: "None" }] },
        ],
      },
    },
    {
      name: "an expense moved to no policy",
      change: (budget: Budget) => {
        budget.expenses[0] = { id: "ins", name: "Insurance", category: "Insurance", amount: 1200, policyId: "" };
      },
      want: {
        section: "Expenses",
        entries: [
          {
            change: "changed",
            name: "Insurance",
            fields: [
              { field: "Amount", before: "$2,400.00/yr", after: "$1,200.00/yr" },
              { field: "Policy", before: "Standard", after: "None" },
            ],
          },
        ],
      },
    },
    {
      name: "a policy's note and rules",
      change: (budget: Budget) => {
        budget.policies[0] = {
          id: "std",
          name: "Standard",
          rules: [
            { unitTypes: ["Residential"], tags: ["hydronic"], weight: 60, method: "equal_per_unit" },
            { unitTypes: [], tags: [], weight: 40, method: "common_interest" },
          ],
        };
      },
      want: {
        section: "Policies",
        entries: [
          {
            change: "changed",
            name: "Standard",
            fields: [
              {
                field: "Rules",
                before: "100% by common interest to Residential",
                after: "60% equal per unit to Residential tagged #hydronic; 40% by common interest to None",
              },
            ],
          },
        ],
      },
    },
    {
      name: "a policy note",
      change: (budget: Budget) => {
        budget.policies = [{ ...(budget.policies[0] as Budget["policies"][number]), note: "Board vote" }];
      },
      want: {
        section: "Policies",
        entries: [{ change: "changed", name: "Standard", fields: [{ field: "Note", before: "", after: "Board vote" }] }],
      },
    },
    {
      name: "the inflation and reserve",
      change: (budget: Budget) => {
        budget.adjustments.inflationPct = 3;
      },
      want: {
        section: "Adjustments",
        entries: [{ change: "changed", name: "Inflation and reserve", fields: [{ field: "Inflation", before: "0%", after: "3%" }] }],
      },
    },
  ])("reports changes to $name", ({ change, want }) => {
    expect(diffBudgets(BASE, edit(change)).sections).toContainEqual(want);
  });

  it("reports changes to other income and offsets", () => {
    const before = edit((budget) => {
      budget.adjustments.incomes = [{ id: "laundry", name: "Laundry", amount: 600 }];
      budget.adjustments.offsets = [{ unitType: "Residential", pct: -5 }];
    });
    const after = edit((budget) => {
      budget.adjustments.incomes = [{ id: "laundry", name: "Laundry room", amount: 900 }];
      budget.adjustments.offsets = [{ unitType: "Residential", pct: 10 }];
    });
    expect(diffBudgets(before, after).sections).toEqual([
      {
        section: "Other income",
        entries: [
          {
            change: "changed",
            name: "Laundry room",
            fields: [
              { field: "Name", before: "Laundry", after: "Laundry room" },
              { field: "Amount", before: "$600.00/yr", after: "$900.00/yr" },
            ],
          },
        ],
      },
      {
        section: "Unit-type offsets",
        entries: [{ change: "changed", name: "Residential", fields: [{ field: "Offset", before: "-5%", after: "10%" }] }],
      },
    ]);
  });

  it("reports added and removed entries in every section", () => {
    const after = edit((budget) => {
      budget.owners.push({ id: "cy", name: "", isBoard: false, currentMonthly: 0 });
      budget.unitTypes.push({ name: "Storage", classification: "ancillary" });
      budget.categories = ["Utilities"];
      budget.expenses = [{ id: "gas", name: "Gas", category: "Utilities", amount: 0, policyId: "std" }];
      budget.policies.push({ id: "new", name: "New", rules: [] });
      budget.adjustments.incomes = [{ id: "laundry", name: "Laundry", amount: 600 }];
      budget.adjustments.offsets = [{ unitType: "Residential", pct: -5 }];
    });
    const sections = diffBudgets(BASE, after).sections;
    expect(sections.map((section) => section.section)).toEqual([
      "Owners",
      "Unit types",
      "Categories",
      "Expenses",
      "Policies",
      "Other income",
      "Unit-type offsets",
    ]);
    expect(sections.flatMap((section) => section.entries)).toEqual([
      { change: "added", name: "(unnamed)" },
      { change: "added", name: "Storage" },
      { change: "removed", name: "Insurance" },
      { change: "added", name: "Utilities" },
      { change: "removed", name: "Insurance" },
      { change: "added", name: "Gas" },
      { change: "added", name: "New" },
      { change: "added", name: "Laundry" },
      { change: "added", name: "Residential" },
    ]);
  });

  it("reads optional adjustments as empty", () => {
    const before = edit((budget) => {
      budget.adjustments = { inflationPct: 0, reservePct: 0, offsets: [{ unitType: "Residential", pct: 10 }] };
    });
    const after = edit((budget) => {
      budget.adjustments = { inflationPct: 0, reservePct: 0, incomes: [{ id: "laundry", name: "Laundry", amount: 0 }] };
    });
    expect(diffBudgets(before, after).sections.flatMap((section) => section.entries)).toEqual([
      { change: "added", name: "Laundry" },
      { change: "removed", name: "Residential" },
    ]);
  });

  it("reports each unit's monthly charge that moves", () => {
    const after = edit((budget) => {
      budget.expenses[0] = { id: "ins", name: "Insurance", category: "Insurance", amount: 3600, policyId: "std" };
      budget.units[1] = { id: "1c", label: "1C", type: "Residential", commonInterest: 50, ownerId: "ben", tags: [] };
    });
    expect(diffBudgets(BASE, after).charges).toEqual([
      { unit: "1A", before: 100, after: 150 },
      { unit: "1C", before: null, after: 150 },
      { unit: "1B", before: 100, after: null },
    ]);
  });

  it("ignores a charge that moves by less than a cent", () => {
    const after = edit((budget) => {
      budget.expenses[0] = { id: "ins", name: "Insurance", category: "Insurance", amount: 2400.01, policyId: "std" };
    });
    expect(diffBudgets(BASE, after).charges).toEqual([]);
  });

  it("compares the sample budget with an empty one", () => {
    const diff = diffBudgets(DEFAULT_BUDGET, BASE);
    expect(isUnchanged(diff)).toBe(false);
    expect(diff.charges).toHaveLength(DEFAULT_BUDGET.units.length + BASE.units.length);
  });
});
