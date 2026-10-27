import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { isEmptyPolicy, normalizeBudget } from "./budget";
import { ALLOCATION_METHODS } from "./types";
import type { Budget, UnitType } from "./types";

// Packed form for the `?b=` param: a positional array with no object keys and no ids.
// Cross-references (owner, policy, unit type, category) are stored as integer indices,
// which keeps the pre-compression text small. ids are dropped and regenerated on load.
// A reference falls back to its raw string when it points outside the lookup list (e.g. an
// imported budget with an orphan type), and to -1 when an owner/policy id resolves to nothing.
type Ref = number | string;
type PackedOwner = [string, 0 | 1, number];
// [name, classification] where 0 = primary, 1 = ancillary. A bare string is also accepted on read
// for budgets shared before classifications existed.
type PackedUnitType = [string, 0 | 1];
// Tags trail the unit and rule tuples so budgets shared before tags existed still decode (as no tags).
type PackedUnit = [string, Ref, number, number, string[]?];
type PackedRule = [Ref[], number, number, string[]?];
type PackedPolicy = [string, PackedRule[]];
type PackedExpense = [string, Ref, number, number];
type PackedAdjustments = [number, number, Array<[Ref, number]>, number];
type Packed = [PackedUnitType[], string[], PackedOwner[], PackedUnit[], PackedPolicy[], PackedExpense[], PackedAdjustments];

const pack = (budget: Budget): Packed => {
  // $0 expenses, empty policies, and 0% offsets have no effect on charges, so they are left out of the URL.
  // Expenses that pointed at a dropped policy decode as having no policy.
  const policies = budget.policies.filter((policy) => !isEmptyPolicy(policy));
  const expenses = budget.expenses.filter((expense) => expense.amount !== 0);
  const offsets = (budget.adjustments.offsets ?? []).filter((offset) => offset.pct !== 0);
  const ownerIndex = new Map(budget.owners.map((owner, i) => [owner.id, i]));
  const policyIndex = new Map(policies.map((policy, i) => [policy.id, i]));
  const typeIndex = new Map(budget.unitTypes.map((type, i) => [type.name, i]));
  const categoryIndex = new Map(budget.categories.map((category, i) => [category, i]));

  const typeRef = (type: string): Ref => typeIndex.get(type) ?? type;
  const adjustments = budget.adjustments;

  return [
    budget.unitTypes.map((type) => [type.name, type.classification === "ancillary" ? 1 : 0] as PackedUnitType),
    budget.categories,
    budget.owners.map((owner) => [owner.name, owner.isBoard ? 1 : 0, owner.currentMonthly] as PackedOwner),
    budget.units.map(
      (unit) => [unit.label, typeRef(unit.type), unit.commonInterest, ownerIndex.get(unit.ownerId) ?? -1, unit.tags] as PackedUnit,
    ),
    policies.map(
      (policy) =>
        [
          policy.name,
          policy.rules.map(
            (rule) => [rule.unitTypes.map(typeRef), rule.weight, ALLOCATION_METHODS.indexOf(rule.method), rule.tags] as PackedRule,
          ),
        ] as PackedPolicy,
    ),
    expenses.map(
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
      offsets.map((offset) => [typeRef(offset.unitType), offset.pct] as [Ref, number]),
      adjustments.incomeOffset ?? 0,
    ],
  ];
};

const unpack = (packed: Packed): Budget => {
  const [unitTypes, categories, owners, units, policies, expenses, adjustments] = packed;
  // A legacy entry may be a bare string instead of [name, classification].
  const unitTypeList: UnitType[] = (unitTypes as Array<PackedUnitType | string>).map((entry) =>
    typeof entry === "string"
      ? { name: entry, classification: "primary" }
      : { name: entry[0], classification: entry[1] === 1 ? "ancillary" : "primary" },
  );
  const resolveType = (ref: Ref): string => (typeof ref === "number" ? (unitTypeList[ref]?.name ?? "") : ref);
  const resolveCategory = (ref: Ref): string => (typeof ref === "number" ? (categories[ref] ?? "") : ref);

  // Derive ids deterministically from position rather than makeId(): unpack runs on both the server
  // and the client when a budget loads from the `?b=` param, and makeId() (Date.now + counter) would
  // produce different ids each run, causing a React hydration mismatch.
  const ownerIds = owners.map((_, i) => `owner-${i}`);
  const policyIds = policies.map((_, i) => `policy-${i}`);

  return normalizeBudget({
    unitTypes: unitTypeList,
    categories,
    owners: owners.map(([name, isBoard, currentMonthly], i) => ({ id: ownerIds[i], name, isBoard: isBoard === 1, currentMonthly })),
    units: units.map(([label, type, commonInterest, ownerRef, tags], i) => ({
      id: `unit-${i}`,
      label,
      type: resolveType(type),
      commonInterest,
      ownerId: ownerRef >= 0 ? (ownerIds[ownerRef] ?? "") : "",
      tags,
    })),
    policies: policies.map(([name, rules], i) => ({
      id: policyIds[i],
      name,
      rules: rules.map(([ruleTypes, weight, methodIdx, tags]) => ({
        unitTypes: ruleTypes.map(resolveType),
        tags,
        weight,
        method: ALLOCATION_METHODS[methodIdx] ?? ALLOCATION_METHODS[0],
      })),
    })),
    expenses: expenses.map(([name, category, amount, policyRef], i) => ({
      id: `exp-${i}`,
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
    return unpack(JSON.parse(json) as Packed);
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
