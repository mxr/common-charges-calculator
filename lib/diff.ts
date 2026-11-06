import { computeCharges } from "./allocate";
import { formatCurrency } from "./format";
import { ALLOCATION_METHOD_LABELS, UNIT_CLASSIFICATION_LABELS } from "./types";
import type { Budget, Expense, Income, Owner, Policy, PolicyRule, TypeOffset, Unit, UnitType } from "./types";

export type FieldChange = { field: string; before: string; after: string };

export type EntryChange = { change: "added" | "removed"; name: string } | { change: "changed"; name: string; fields: FieldChange[] };

export type SectionDiff = { section: string; entries: EntryChange[] };

// Monthly charges. Null means the unit is not in that budget.
export type ChargeChange = { unit: string; before: number | null; after: number | null };

export type BudgetDiff = { sections: SectionDiff[]; charges: ChargeChange[] };

// A field reads its value from one side of the diff, so names it looks up come from the same budget.
type Field<T> = [label: string, value: (item: T, budget: Budget) => string];

type Section<T> = {
  section: string;
  items: (budget: Budget) => T[];
  key: (item: T) => string;
  name: (item: T) => string;
  fields: Field<T>[];
};

const named = (value: string): string => value || "(unnamed)";

const yesNo = (value: boolean): string => (value ? "Yes" : "No");

const listOrNone = (values: string[]): string => (values.length > 0 ? values.join(", ") : "None");

const ownerName = (budget: Budget, id: string): string => {
  const owner = budget.owners.find((item) => item.id === id);
  return owner === undefined ? "Unassigned" : named(owner.name);
};

const policyName = (budget: Budget, id: string): string => {
  const policy = budget.policies.find((item) => item.id === id);
  return policy === undefined ? "None" : named(policy.name);
};

const describeRule = (rule: PolicyRule): string => {
  const tags = rule.tags.length > 0 ? ` tagged ${rule.tags.map((tag) => `#${tag}`).join(", ")}` : "";
  return `${rule.weight}% ${ALLOCATION_METHOD_LABELS[rule.method].toLowerCase()} to ${listOrNone(rule.unitTypes)}${tags}`;
};

const percent = (value: number): string => `${value}%`;

const OWNERS: Section<Owner> = {
  section: "Owners",
  items: (budget) => budget.owners,
  key: (owner) => owner.id,
  name: (owner) => named(owner.name),
  fields: [
    ["Name", (owner) => owner.name],
    ["Current $/mo", (owner) => formatCurrency(owner.currentMonthly)],
    ["Board", (owner) => yesNo(owner.isBoard)],
  ],
};

// Units and rules refer to a unit type by name, so a rename shows as one type removed and another added.
const UNIT_TYPES: Section<UnitType> = {
  section: "Unit types",
  items: (budget) => budget.unitTypes,
  key: (type) => type.name,
  name: (type) => named(type.name),
  fields: [["Classification", (type) => UNIT_CLASSIFICATION_LABELS[type.classification]]],
};

const UNITS: Section<Unit> = {
  section: "Units",
  items: (budget) => budget.units,
  key: (unit) => unit.id,
  name: (unit) => named(unit.label),
  fields: [
    ["Label", (unit) => unit.label],
    ["Type", (unit) => unit.type],
    ["Common interest", (unit) => percent(unit.commonInterest)],
    ["Owner", (unit, budget) => ownerName(budget, unit.ownerId)],
    ["Tags", (unit) => listOrNone(unit.tags)],
  ],
};

const CATEGORIES: Section<string> = {
  section: "Categories",
  items: (budget) => budget.categories,
  key: (category) => category,
  name: named,
  fields: [],
};

const EXPENSES: Section<Expense> = {
  section: "Expenses",
  items: (budget) => budget.expenses,
  key: (expense) => expense.id,
  name: (expense) => named(expense.name),
  fields: [
    ["Name", (expense) => expense.name],
    ["Category", (expense) => expense.category],
    ["Amount", (expense) => `${formatCurrency(expense.amount)}/yr`],
    ["Policy", (expense, budget) => policyName(budget, expense.policyId)],
  ],
};

const POLICIES: Section<Policy> = {
  section: "Policies",
  items: (budget) => budget.policies,
  key: (policy) => policy.id,
  name: (policy) => named(policy.name),
  fields: [
    ["Name", (policy) => policy.name],
    ["Note", (policy) => policy.note ?? ""],
    ["Rules", (policy) => policy.rules.map(describeRule).join("; ")],
  ],
};

const ADJUSTMENTS: Section<Budget["adjustments"]> = {
  section: "Adjustments",
  items: (budget) => [budget.adjustments],
  key: () => "adjustments",
  name: () => "Inflation and reserve",
  fields: [
    ["Inflation", (adjustments) => percent(adjustments.inflationPct)],
    ["Reserve", (adjustments) => percent(adjustments.reservePct)],
  ],
};

const INCOMES: Section<Income> = {
  section: "Other income",
  items: (budget) => budget.adjustments.incomes ?? [],
  key: (income) => income.id,
  name: (income) => named(income.name),
  fields: [
    ["Name", (income) => income.name],
    ["Amount", (income) => `${formatCurrency(income.amount)}/yr`],
  ],
};

const OFFSETS: Section<TypeOffset> = {
  section: "Unit-type offsets",
  items: (budget) => budget.adjustments.offsets ?? [],
  key: (offset) => offset.unitType,
  name: (offset) => named(offset.unitType),
  fields: [["Offset", (offset) => percent(offset.pct)]],
};

// Order is left out: reordering changes how the calculator lists entries, not what anyone pays.
const diffSection = <T>({ section, items, key, name, fields }: Section<T>, before: Budget, after: Budget): SectionDiff => {
  const old = new Map(items(before).map((item) => [key(item), item]));
  const next = new Map(items(after).map((item) => [key(item), item]));
  const entries: EntryChange[] = [];
  for (const [id, item] of old) {
    if (!next.has(id)) {
      entries.push({ change: "removed", name: name(item) });
    }
  }
  for (const [id, item] of next) {
    const prev = old.get(id);
    if (prev === undefined) {
      entries.push({ change: "added", name: name(item) });
      continue;
    }
    const changed = fields
      .map(([field, value]) => ({ field, before: value(prev, before), after: value(item, after) }))
      .filter((change) => change.before !== change.after);
    if (changed.length > 0) {
      entries.push({ change: "changed", name: name(item), fields: changed });
    }
  }
  return { section, entries };
};

// Below a cent a month, a change is rounding.
const CHARGE_TOLERANCE = 0.005;

const diffCharges = (before: Budget, after: Budget): ChargeChange[] => {
  const old = new Map(computeCharges(before).perUnit.map((unit) => [unit.unitId, unit]));
  const next = new Map(computeCharges(after).perUnit.map((unit) => [unit.unitId, unit]));
  const changes: ChargeChange[] = [];
  for (const [id, unit] of next) {
    const prev = old.get(id);
    if (prev === undefined || Math.abs(prev.monthly - unit.monthly) >= CHARGE_TOLERANCE) {
      changes.push({ unit: named(unit.label), before: prev?.monthly ?? null, after: unit.monthly });
    }
  }
  for (const [id, unit] of old) {
    if (!next.has(id)) {
      changes.push({ unit: named(unit.label), before: unit.monthly, after: null });
    }
  }
  return changes;
};

// What changed from `before` to `after`, and how it moves each unit's monthly charge.
export const diffBudgets = (before: Budget, after: Budget): BudgetDiff => ({
  sections: [
    diffSection(OWNERS, before, after),
    diffSection(UNIT_TYPES, before, after),
    diffSection(UNITS, before, after),
    diffSection(CATEGORIES, before, after),
    diffSection(EXPENSES, before, after),
    diffSection(POLICIES, before, after),
    diffSection(ADJUSTMENTS, before, after),
    diffSection(INCOMES, before, after),
    diffSection(OFFSETS, before, after),
  ].filter((section) => section.entries.length > 0),
  charges: diffCharges(before, after),
});

export const isUnchanged = (diff: BudgetDiff): boolean => diff.sections.length === 0 && diff.charges.length === 0;
