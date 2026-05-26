export type AllocationMethod = "common_interest" | "equal_per_unit";

export const ALLOCATION_METHODS: AllocationMethod[] = ["common_interest", "equal_per_unit"];

export const ALLOCATION_METHOD_LABELS: Record<AllocationMethod, string> = {
  common_interest: "By common interest",
  equal_per_unit: "Equal per unit",
};

// A policy splits one expense into one or more rules. Each rule takes `weight`% of
// the expense and divides it among units of the explicitly listed types using
// `method` (empty list = no eligible units). Rule weights in a policy are expected to sum to 100.
export type PolicyRule = {
  unitTypes: string[];
  weight: number;
  method: AllocationMethod;
};

export type Policy = {
  id: string;
  name: string;
  rules: PolicyRule[];
};

// An excluded owner's units pay nothing and are dropped from every split, so the
// remaining units absorb the cost.
export type Owner = {
  id: string;
  name: string;
  excluded: boolean;
  // What this owner currently pays per month, for comparison against the computed charge.
  currentMonthly: number;
};

export type Unit = {
  id: string;
  label: string;
  type: string;
  commonInterest: number;
  ownerId: string;
};

// Whether a unit type is a primary dwelling or an ancillary space (storage, parking, etc.).
// Bookkeeping only for now; it does not affect how charges are computed.
export type UnitClassification = "primary" | "ancillary";

export const UNIT_CLASSIFICATIONS: UnitClassification[] = ["primary", "ancillary"];

export const UNIT_CLASSIFICATION_LABELS: Record<UnitClassification, string> = {
  primary: "Primary",
  ancillary: "Ancillary",
};

// A unit type is referenced by its `name` everywhere else (units, policy rules, offsets).
export type UnitType = {
  name: string;
  classification: UnitClassification;
};

export type Expense = {
  id: string;
  name: string;
  category: string;
  amount: number;
  policyId: string;
};

// A percentage adjustment applied to every unit of a given type (e.g. -5% to Commercial).
export type TypeOffset = {
  unitType: string;
  pct: number;
};

export type Adjustments = {
  // Multiplies the entered expense amounts (treats them as a prior-year baseline).
  inflationPct: number;
  // Added on top of each unit's final charge to build a reserve / savings fund.
  reservePct: number;
  // Per-unit-type percentage offsets applied to each affected unit's charge.
  offsets?: TypeOffset[];
  // Flat annual income from non-common-charge sources; reduces the total owners must cover,
  // spread across units proportional to their base charge.
  incomeOffset?: number;
};

export type Budget = {
  owners: Owner[];
  units: Unit[];
  unitTypes: UnitType[];
  categories: string[];
  expenses: Expense[];
  policies: Policy[];
  adjustments: Adjustments;
};
