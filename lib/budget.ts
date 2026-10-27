import { ALLOCATION_METHODS, UNIT_CLASSIFICATIONS } from "./types";
import type {
  Adjustments,
  AllocationMethod,
  Budget,
  Expense,
  Owner,
  Policy,
  PolicyRule,
  TypeOffset,
  Unit,
  UnitClassification,
  UnitType,
} from "./types";

let idCounter = 0;

export const makeId = (prefix: string) => {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
};

export const DEFAULT_UNIT_TYPES: UnitType[] = [
  { name: "Residential", classification: "primary" },
  { name: "Commercial", classification: "primary" },
  { name: "Storage", classification: "ancillary" },
  { name: "Garage", classification: "ancillary" },
  { name: "Cabana", classification: "ancillary" },
];
export const DEFAULT_CATEGORIES = ["Insurance", "Utilities", "Maintenance", "Services"];

export const DEFAULT_BUDGET: Budget = {
  owners: [
    { id: "owner-alice", name: "Alice", isBoard: false, currentMonthly: 740 },
    { id: "owner-bob", name: "Bob", isBoard: false, currentMonthly: 1150 },
    { id: "owner-carol", name: "Carol", isBoard: false, currentMonthly: 680 },
    { id: "owner-llc", name: "Maple Holdings LLC", isBoard: false, currentMonthly: 440 },
    { id: "owner-board", name: "Board", isBoard: true, currentMonthly: 0 },
  ],
  // Several units per type share the same common interest, and types mix owners, so sorting by
  // common interest then label, or owner then number, shows the earlier sort surviving as ties break.
  units: [
    { id: "unit-1a", label: "1A", type: "Residential", commonInterest: 12, ownerId: "owner-alice", tags: ["hydronic"] },
    { id: "unit-1b", label: "1B", type: "Residential", commonInterest: 8, ownerId: "owner-bob", tags: ["hydronic"] },
    { id: "unit-2a", label: "2A", type: "Residential", commonInterest: 12, ownerId: "owner-carol", tags: ["hydronic"] },
    { id: "unit-2b", label: "2B", type: "Residential", commonInterest: 8, ownerId: "owner-alice", tags: ["hydronic"] },
    { id: "unit-3n", label: "3N", type: "Residential", commonInterest: 13, ownerId: "owner-bob", tags: [] },
    { id: "unit-3s", label: "3S", type: "Residential", commonInterest: 9, ownerId: "owner-llc", tags: [] },
    { id: "unit-cu1", label: "CU1", type: "Commercial", commonInterest: 9, ownerId: "owner-llc", tags: [] },
    { id: "unit-cu2", label: "CU2", type: "Commercial", commonInterest: 9, ownerId: "owner-carol", tags: [] },
    { id: "unit-s1", label: "S1", type: "Storage", commonInterest: 2, ownerId: "owner-board", tags: [] },
    { id: "unit-s2", label: "S2", type: "Storage", commonInterest: 2, ownerId: "owner-alice", tags: [] },
    { id: "unit-g1", label: "G1", type: "Garage", commonInterest: 3, ownerId: "owner-bob", tags: [] },
    { id: "unit-g2", label: "G2", type: "Garage", commonInterest: 3, ownerId: "owner-carol", tags: [] },
    { id: "unit-c1", label: "C1", type: "Cabana", commonInterest: 10, ownerId: "owner-bob", tags: [] },
  ],
  unitTypes: [...DEFAULT_UNIT_TYPES],
  categories: [...DEFAULT_CATEGORIES],
  policies: [
    {
      id: "policy-standard",
      name: "Standard (by common interest)",
      rules: [
        { unitTypes: ["Residential", "Commercial", "Storage", "Garage", "Cabana"], tags: [], weight: 100, method: "common_interest" },
      ],
    },
    {
      id: "policy-no-commercial",
      name: "Exclude commercial",
      rules: [{ unitTypes: ["Residential", "Storage", "Garage", "Cabana"], tags: [], weight: 100, method: "common_interest" }],
    },
    {
      id: "policy-per-residential",
      name: "Equal per residential unit",
      rules: [{ unitTypes: ["Residential"], tags: [], weight: 100, method: "equal_per_unit" }],
    },
    {
      id: "policy-super",
      name: "5% commercial / 95% rest",
      rules: [
        { unitTypes: ["Commercial"], tags: [], weight: 5, method: "common_interest" },
        { unitTypes: ["Residential", "Storage", "Garage", "Cabana"], tags: [], weight: 95, method: "common_interest" },
      ],
    },
    {
      id: "policy-parking",
      name: "Garage & storage only",
      rules: [{ unitTypes: ["Garage", "Storage"], tags: [], weight: 100, method: "equal_per_unit" }],
    },
    {
      id: "policy-hydronic",
      name: "Hydronic units only",
      rules: [{ unitTypes: ["Residential"], tags: ["hydronic"], weight: 100, method: "common_interest" }],
    },
  ],
  // Within each category several line items share an amount or a split policy, so sorting by amount
  // then name, or split then amount, demonstrates that the earlier sort survives as a tiebreaker.
  expenses: [
    { id: "exp-insurance", name: "Building insurance", category: "Insurance", amount: 3600, policyId: "policy-standard" },
    { id: "exp-umbrella", name: "Umbrella liability", category: "Insurance", amount: 3600, policyId: "policy-standard" },
    { id: "exp-flood", name: "Flood insurance", category: "Insurance", amount: 1200, policyId: "policy-no-commercial" },
    { id: "exp-water", name: "Water & sewer", category: "Utilities", amount: 1800, policyId: "policy-standard" },
    { id: "exp-electric", name: "Electric (common)", category: "Utilities", amount: 1800, policyId: "policy-super" },
    { id: "exp-gas", name: "Gas", category: "Utilities", amount: 900, policyId: "policy-standard" },
    { id: "exp-hydronic", name: "Hydronic heating", category: "Utilities", amount: 1200, policyId: "policy-hydronic" },
    { id: "exp-fiber", name: "Fiber internet", category: "Utilities", amount: 900, policyId: "policy-per-residential" },
    { id: "exp-elevator", name: "Elevator maintenance", category: "Maintenance", amount: 1400, policyId: "policy-no-commercial" },
    { id: "exp-roof", name: "Roof repair", category: "Maintenance", amount: 1400, policyId: "policy-standard" },
    { id: "exp-landscaping", name: "Landscaping", category: "Maintenance", amount: 1400, policyId: "policy-standard" },
    { id: "exp-garage-clean", name: "Garage cleaning", category: "Maintenance", amount: 600, policyId: "policy-parking" },
    { id: "exp-super", name: "Superintendent", category: "Services", amount: 9000, policyId: "policy-super" },
    { id: "exp-mgmt", name: "Property management", category: "Services", amount: 2700, policyId: "policy-standard" },
    { id: "exp-snow", name: "Snow removal", category: "Services", amount: 2700, policyId: "policy-parking" },
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

// Trims, drops blanks, and de-duplicates freeform tags while keeping their first-seen order.
export const normalizeTags = (value: unknown): string[] => [
  ...new Set(
    asStringArray(value)
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];

const normalizeMethod = (value: unknown): AllocationMethod =>
  ALLOCATION_METHODS.includes(value as AllocationMethod) ? (value as AllocationMethod) : "common_interest";

const normalizeClassification = (value: unknown): UnitClassification =>
  UNIT_CLASSIFICATIONS.includes(value as UnitClassification) ? (value as UnitClassification) : "primary";

// Accepts both the current object form and the legacy bare-string form (which becomes a primary type).
const normalizeUnitType = (value: unknown): UnitType | null => {
  if (typeof value === "string") {
    return value ? { name: value, classification: "primary" } : null;
  }
  const raw = (value ?? {}) as Partial<Record<keyof UnitType, unknown>>;
  const name = asString(raw.name);
  return name ? { name, classification: normalizeClassification(raw.classification) } : null;
};

const normalizeUnitTypes = (value: unknown): UnitType[] =>
  Array.isArray(value) ? value.map(normalizeUnitType).filter((type): type is UnitType => type !== null) : [];

const normalizeRule = (value: unknown): PolicyRule => {
  const raw = (value ?? {}) as Partial<Record<keyof PolicyRule, unknown>>;
  return {
    unitTypes: asStringArray(raw.unitTypes),
    tags: normalizeTags(raw.tags),
    weight: asNumber(raw.weight),
    method: normalizeMethod(raw.method),
  };
};

const normalizePolicy = (value: unknown, index: number): Policy => {
  const raw = (value ?? {}) as Partial<Record<keyof Policy, unknown>>;
  const rules = Array.isArray(raw.rules) ? raw.rules.map(normalizeRule) : [];
  return {
    id: asString(raw.id) || makeId("policy"),
    name: asString(raw.name) || `Policy ${index + 1}`,
    rules: rules.length > 0 ? rules : [{ unitTypes: [], tags: [], weight: 100, method: "common_interest" }],
  };
};

const normalizeOwner = (value: unknown, index: number): Owner => {
  const raw = (value ?? {}) as Partial<Record<keyof Owner, unknown>>;
  return {
    id: asString(raw.id) || makeId("owner"),
    name: asString(raw.name) || `Owner ${index + 1}`,
    // Budgets saved before the board flag existed marked board owners as `excluded`.
    isBoard: Boolean(raw.isBoard ?? (raw as { excluded?: unknown }).excluded),
    currentMonthly: asNumber(raw.currentMonthly),
  };
};

const normalizeUnit = (value: unknown, index: number): Unit => {
  const raw = (value ?? {}) as Partial<Record<keyof Unit, unknown>>;
  return {
    id: asString(raw.id) || makeId("unit"),
    label: asString(raw.label) || `Unit ${index + 1}`,
    type: asString(raw.type),
    commonInterest: asNumber(raw.commonInterest),
    ownerId: asString(raw.ownerId),
    tags: normalizeTags(raw.tags),
  };
};

const normalizeExpense = (value: unknown, index: number): Expense => {
  const raw = (value ?? {}) as Partial<Record<keyof Expense, unknown>>;
  return {
    id: asString(raw.id) || makeId("exp"),
    name: asString(raw.name) || `Expense ${index + 1}`,
    category: asString(raw.category),
    amount: asNumber(raw.amount),
    policyId: asString(raw.policyId),
  };
};

const normalizeOffset = (value: unknown): TypeOffset => {
  const raw = (value ?? {}) as Partial<Record<keyof TypeOffset, unknown>>;
  return { unitType: asString(raw.unitType), pct: asNumber(raw.pct) };
};

const normalizeAdjustments = (value: unknown): Adjustments => {
  const raw = (value ?? {}) as Partial<Record<keyof Adjustments, unknown>>;
  return {
    inflationPct: asNumber(raw.inflationPct),
    reservePct: asNumber(raw.reservePct),
    offsets: Array.isArray(raw.offsets) ? raw.offsets.map(normalizeOffset) : [],
    incomeOffset: asNumber(raw.incomeOffset),
  };
};

// Coerce an untrusted parsed object (from URL or imported file) into a valid Budget.
export const normalizeBudget = (value: unknown): Budget => {
  const raw = (value ?? {}) as Partial<Record<keyof Budget, unknown>>;
  const owners = Array.isArray(raw.owners) ? raw.owners.map(normalizeOwner) : [];
  // Only one owner can be the board; keep the first.
  const boardIndex = owners.findIndex((owner) => owner.isBoard);
  return {
    owners: owners.map((owner, i) => (owner.isBoard && i !== boardIndex ? { ...owner, isBoard: false } : owner)),
    units: Array.isArray(raw.units) ? raw.units.map(normalizeUnit) : [],
    unitTypes: normalizeUnitTypes(raw.unitTypes),
    categories: asStringArray(raw.categories),
    policies: Array.isArray(raw.policies) ? raw.policies.map(normalizePolicy) : [],
    expenses: Array.isArray(raw.expenses) ? raw.expenses.map(normalizeExpense) : [],
    adjustments: normalizeAdjustments(raw.adjustments),
  };
};

// True when no rule both carries weight and targets a unit type, so the policy allocates nothing.
export const isEmptyPolicy = (policy: Policy): boolean => policy.rules.every((rule) => rule.weight === 0 || rule.unitTypes.length === 0);

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

  const usedTags = new Set(budget.units.flatMap((unit) => unit.tags));
  for (const policy of budget.policies) {
    for (const tag of new Set(policy.rules.flatMap((rule) => rule.tags))) {
      if (!usedTags.has(tag)) {
        warnings.push(`Policy "${policy.name}" references tag "${tag}", which no unit has.`);
      }
    }
  }

  const policyById = new Map(budget.policies.map((policy) => [policy.id, policy]));
  const ownerIds = new Set(budget.owners.map((owner) => owner.id));
  const unitTypeSet = new Set(budget.unitTypes.map((type) => type.name));

  for (const expense of budget.expenses) {
    const policy = policyById.get(expense.policyId);
    if (!policy) {
      warnings.push(`Expense "${expense.name}" has no valid policy.`);
    } else if (isEmptyPolicy(policy)) {
      warnings.push(`Expense "${expense.name}" uses policy "${policy.name}", which allocates to no unit types.`);
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
    if (!usedUnitTypes.has(type.name)) {
      warnings.push(`Unit type "${type.name}" is not used by any unit.`);
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
