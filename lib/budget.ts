import { ALLOCATION_METHODS } from "./types";
import type { Adjustments, AllocationMethod, Budget, Expense, Owner, Policy, PolicyRule, TypeOffset, Unit } from "./types";

let idCounter = 0;

export const makeId = (prefix: string) => {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
};

export const DEFAULT_UNIT_TYPES = ["Residential", "Commercial", "Storage", "Garage", "Cabana"];
export const DEFAULT_CATEGORIES = ["Insurance", "Utilities", "Maintenance", "Services"];

export const DEFAULT_BUDGET: Budget = {
  owners: [
    { id: "owner-alice", name: "Alice", excluded: false, currentMonthly: 1000 },
    { id: "owner-bob", name: "Bob", excluded: false, currentMonthly: 900 },
    { id: "owner-llc", name: "Maple Holdings LLC", excluded: false, currentMonthly: 650 },
    { id: "owner-board", name: "Board", excluded: true, currentMonthly: 0 },
  ],
  units: [
    { id: "unit-1a", label: "1A", type: "Residential", commonInterest: 30, ownerId: "owner-alice" },
    { id: "unit-1b", label: "1B", type: "Residential", commonInterest: 30, ownerId: "owner-bob" },
    { id: "unit-cu1", label: "CU1", type: "Commercial", commonInterest: 20, ownerId: "owner-llc" },
    { id: "unit-s1", label: "S1", type: "Storage", commonInterest: 5, ownerId: "owner-board" },
    { id: "unit-g1", label: "G1", type: "Garage", commonInterest: 10, ownerId: "owner-alice" },
    { id: "unit-c1", label: "C1", type: "Cabana", commonInterest: 5, ownerId: "owner-bob" },
  ],
  unitTypes: [...DEFAULT_UNIT_TYPES],
  categories: [...DEFAULT_CATEGORIES],
  policies: [
    {
      id: "policy-standard",
      name: "Standard (by common interest)",
      rules: [{ unitTypes: ["Residential", "Commercial", "Storage", "Garage", "Cabana"], weight: 100, method: "common_interest" }],
    },
    {
      id: "policy-no-commercial",
      name: "Exclude commercial",
      rules: [{ unitTypes: ["Residential", "Storage", "Garage", "Cabana"], weight: 100, method: "common_interest" }],
    },
    {
      id: "policy-per-residential",
      name: "Equal per residential unit",
      rules: [{ unitTypes: ["Residential"], weight: 100, method: "equal_per_unit" }],
    },
    {
      id: "policy-super",
      name: "5% commercial / 95% rest",
      rules: [
        { unitTypes: ["Commercial"], weight: 5, method: "common_interest" },
        { unitTypes: ["Residential", "Storage", "Garage", "Cabana"], weight: 95, method: "common_interest" },
      ],
    },
  ],
  expenses: [
    { id: "exp-insurance", name: "Building insurance", category: "Insurance", amount: 24000, policyId: "policy-standard" },
    { id: "exp-water", name: "Water & sewer", category: "Utilities", amount: 12000, policyId: "policy-standard" },
    { id: "exp-elevator", name: "Elevator maintenance", category: "Maintenance", amount: 9000, policyId: "policy-no-commercial" },
    { id: "exp-fiber", name: "Fiber internet", category: "Utilities", amount: 6000, policyId: "policy-per-residential" },
    { id: "exp-super", name: "Superintendent", category: "Services", amount: 60000, policyId: "policy-super" },
  ],
  adjustments: { inflationPct: 0, reservePct: 10, offsets: [], incomeOffset: 0 },
};

const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const normalizeMethod = (value: unknown): AllocationMethod =>
  ALLOCATION_METHODS.includes(value as AllocationMethod) ? (value as AllocationMethod) : "common_interest";

const normalizeRule = (value: unknown): PolicyRule => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    unitTypes: asStringArray(raw.unitTypes),
    weight: asNumber(raw.weight),
    method: normalizeMethod(raw.method),
  };
};

const normalizePolicy = (value: unknown, index: number): Policy => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const rules = Array.isArray(raw.rules) ? raw.rules.map(normalizeRule) : [];
  return {
    id: asString(raw.id) || makeId("policy"),
    name: asString(raw.name) || `Policy ${index + 1}`,
    rules: rules.length > 0 ? rules : [{ unitTypes: [], weight: 100, method: "common_interest" }],
  };
};

const normalizeOwner = (value: unknown, index: number): Owner => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asString(raw.id) || makeId("owner"),
    name: asString(raw.name) || `Owner ${index + 1}`,
    excluded: Boolean(raw.excluded),
    currentMonthly: asNumber(raw.currentMonthly),
  };
};

const normalizeUnit = (value: unknown, index: number): Unit => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asString(raw.id) || makeId("unit"),
    label: asString(raw.label) || `Unit ${index + 1}`,
    type: asString(raw.type),
    commonInterest: asNumber(raw.commonInterest),
    ownerId: asString(raw.ownerId),
  };
};

const normalizeExpense = (value: unknown, index: number): Expense => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asString(raw.id) || makeId("exp"),
    name: asString(raw.name) || `Expense ${index + 1}`,
    category: asString(raw.category),
    amount: asNumber(raw.amount),
    policyId: asString(raw.policyId),
  };
};

const normalizeOffset = (value: unknown): TypeOffset => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return { unitType: asString(raw.unitType), pct: asNumber(raw.pct) };
};

const normalizeAdjustments = (value: unknown): Adjustments => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    inflationPct: asNumber(raw.inflationPct),
    reservePct: asNumber(raw.reservePct),
    offsets: Array.isArray(raw.offsets) ? raw.offsets.map(normalizeOffset) : [],
    incomeOffset: asNumber(raw.incomeOffset),
  };
};

// Coerce an untrusted parsed object (from URL or imported file) into a valid Budget.
export const normalizeBudget = (value: unknown): Budget => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    owners: Array.isArray(raw.owners) ? raw.owners.map(normalizeOwner) : [],
    units: Array.isArray(raw.units) ? raw.units.map(normalizeUnit) : [],
    unitTypes: asStringArray(raw.unitTypes),
    categories: asStringArray(raw.categories),
    policies: Array.isArray(raw.policies) ? raw.policies.map(normalizePolicy) : [],
    expenses: Array.isArray(raw.expenses) ? raw.expenses.map(normalizeExpense) : [],
    adjustments: normalizeAdjustments(raw.adjustments),
  };
};

const approxEqual = (a: number, b: number, epsilon = 0.01) => Math.abs(a - b) <= epsilon;

// Returns human-readable warnings about a budget; an empty array means it is consistent.
export const validateBudget = (budget: Budget): string[] => {
  const warnings: string[] = [];

  const ciSum = budget.units.reduce((sum, unit) => sum + unit.commonInterest, 0);
  if (budget.units.length > 0 && !approxEqual(ciSum, 100)) {
    warnings.push(`Common interests sum to ${ciSum.toFixed(2)}%, expected 100%.`);
  }

  for (const policy of budget.policies) {
    const weightSum = policy.rules.reduce((sum, rule) => sum + rule.weight, 0);
    if (!approxEqual(weightSum, 100)) {
      warnings.push(`Policy "${policy.name}" rule weights sum to ${weightSum.toFixed(2)}%, expected 100%.`);
    }
  }

  const policyIds = new Set(budget.policies.map((policy) => policy.id));
  const ownerIds = new Set(budget.owners.map((owner) => owner.id));
  const unitTypeSet = new Set(budget.unitTypes);

  for (const expense of budget.expenses) {
    if (!expense.policyId || !policyIds.has(expense.policyId)) {
      warnings.push(`Expense "${expense.name}" has no valid policy.`);
    }
    if (expense.amount === 0) {
      warnings.push(`Expense "${expense.name}" is $0.`);
    }
  }

  const referencedOwners = new Set(budget.units.map((unit) => unit.ownerId));
  for (const owner of budget.owners) {
    if (!referencedOwners.has(owner.id)) {
      warnings.push(`Owner "${owner.name}" is not assigned to any unit.`);
    }
  }

  const usedUnitTypes = new Set(budget.units.map((unit) => unit.type));
  for (const type of budget.unitTypes) {
    if (!usedUnitTypes.has(type)) {
      warnings.push(`Unit type "${type}" is not used by any unit.`);
    }
  }

  const usedCategories = new Set(budget.expenses.map((expense) => expense.category));
  for (const category of budget.categories) {
    if (!usedCategories.has(category)) {
      warnings.push(`Category "${category}" is not used by any expense.`);
    }
  }

  for (const unit of budget.units) {
    if (!ownerIds.has(unit.ownerId)) {
      warnings.push(`Unit "${unit.label}" references an unknown owner.`);
    }
    if (unit.type && !unitTypeSet.has(unit.type)) {
      warnings.push(`Unit "${unit.label}" has unknown type "${unit.type}".`);
    }
  }

  return warnings;
};
