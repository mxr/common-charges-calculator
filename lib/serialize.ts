import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { makeId, normalizeBudget } from "./budget";
import { ALLOCATION_METHODS } from "./types";
import type { Budget } from "./types";

// Packed form for the `?b=` param: a positional array with no object keys and no ids.
// Cross-references (owner, policy, unit type, category) are stored as integer indices,
// which keeps the pre-compression text small. ids are dropped and regenerated on load.
// A reference falls back to its raw string when it points outside the lookup list (e.g. an
// imported budget with an orphan type), and to -1 when an owner/policy id resolves to nothing.
type Ref = number | string;
type PackedOwner = [string, 0 | 1, number];
type PackedUnit = [string, Ref, number, number];
type PackedRule = [Ref[], number, number];
type PackedPolicy = [string, PackedRule[]];
type PackedExpense = [string, Ref, number, number];
type PackedAdjustments = [number, number, Array<[Ref, number]>, number];
type Packed = [string[], string[], PackedOwner[], PackedUnit[], PackedPolicy[], PackedExpense[], PackedAdjustments];

const pack = (budget: Budget): Packed => {
  const ownerIndex = new Map(budget.owners.map((owner, i) => [owner.id, i]));
  const policyIndex = new Map(budget.policies.map((policy, i) => [policy.id, i]));
  const typeIndex = new Map(budget.unitTypes.map((type, i) => [type, i]));
  const categoryIndex = new Map(budget.categories.map((category, i) => [category, i]));

  const typeRef = (type: string): Ref => typeIndex.get(type) ?? type;
  const adjustments = budget.adjustments;

  return [
    budget.unitTypes,
    budget.categories,
    budget.owners.map((owner) => [owner.name, owner.excluded ? 1 : 0, owner.currentMonthly] as PackedOwner),
    budget.units.map((unit) => [unit.label, typeRef(unit.type), unit.commonInterest, ownerIndex.get(unit.ownerId) ?? -1] as PackedUnit),
    budget.policies.map(
      (policy) =>
        [
          policy.name,
          policy.rules.map((rule) => [rule.unitTypes.map(typeRef), rule.weight, ALLOCATION_METHODS.indexOf(rule.method)] as PackedRule),
        ] as PackedPolicy,
    ),
    budget.expenses.map(
      (expense) =>
        [
          expense.name,
          categoryIndex.get(expense.category) ?? expense.category,
          expense.amount,
          policyIndex.get(expense.policyId) ?? -1,
        ] as PackedExpense,
    ),
    [
      adjustments.inflationPct,
      adjustments.reservePct,
      (adjustments.offsets ?? []).map((offset) => [typeRef(offset.unitType), offset.pct] as [Ref, number]),
      adjustments.incomeOffset ?? 0,
    ],
  ];
};

const unpack = (packed: Packed): Budget => {
  const [unitTypes, categories, owners, units, policies, expenses, adjustments] = packed;
  const resolveType = (ref: Ref): string => (typeof ref === "number" ? (unitTypes[ref] ?? "") : ref);
  const resolveCategory = (ref: Ref): string => (typeof ref === "number" ? (categories[ref] ?? "") : ref);

  const ownerIds = owners.map(() => makeId("owner"));
  const policyIds = policies.map(() => makeId("policy"));

  return normalizeBudget({
    unitTypes,
    categories,
    owners: owners.map(([name, excluded, currentMonthly], i) => ({ id: ownerIds[i], name, excluded: excluded === 1, currentMonthly })),
    units: units.map(([label, type, commonInterest, ownerRef]) => ({
      id: makeId("unit"),
      label,
      type: resolveType(type),
      commonInterest,
      ownerId: ownerRef >= 0 ? (ownerIds[ownerRef] ?? "") : "",
    })),
    policies: policies.map(([name, rules], i) => ({
      id: policyIds[i],
      name,
      rules: rules.map(([ruleTypes, weight, methodIdx]) => ({
        unitTypes: ruleTypes.map(resolveType),
        weight,
        method: ALLOCATION_METHODS[methodIdx] ?? ALLOCATION_METHODS[0],
      })),
    })),
    expenses: expenses.map(([name, category, amount, policyRef]) => ({
      id: makeId("exp"),
      name,
      category: resolveCategory(category),
      amount,
      policyId: policyRef >= 0 ? (policyIds[policyRef] ?? "") : "",
    })),
    adjustments: {
      inflationPct: adjustments[0],
      reservePct: adjustments[1],
      offsets: adjustments[2].map(([unitType, pct]) => ({ unitType: resolveType(unitType), pct })),
      incomeOffset: adjustments[3],
    },
  });
};

// Compact, URL-safe encoding for the `?b=` param.
export const serializeBudgetUrl = (budget: Budget): string => compressToEncodedURIComponent(JSON.stringify(pack(budget)));

export const parseBudgetUrl = (value: string | null): Budget | null => {
  if (!value) {
    return null;
  }
  try {
    const json = decompressFromEncodedURIComponent(value);
    if (!json) {
      return null;
    }
    const parsed = JSON.parse(json);
    // New links are a packed array; older links stored the full budget object.
    return Array.isArray(parsed) ? unpack(parsed as Packed) : normalizeBudget(parsed);
  } catch {
    return null;
  }
};

// Human-readable form for file download.
export const exportBudgetJson = (budget: Budget): string => JSON.stringify(budget, null, 2);

export const parseBudgetJson = (text: string): Budget | null => {
  try {
    return normalizeBudget(JSON.parse(text));
  } catch {
    return null;
  }
};
