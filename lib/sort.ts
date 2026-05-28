import type { Expense, Owner, Unit, UnitClassification, UnitType } from "./types";

export type ExpenseSortKey = "name" | "amount" | "split";

export const EXPENSE_SORT_LABELS: Record<ExpenseSortKey, string> = {
  name: "Name",
  amount: "Amount",
  split: "Split",
};

export type UnitSortKey = "label" | "ci";

export const UNIT_SORT_LABELS: Record<UnitSortKey, string> = {
  label: "Number",
  ci: "Common interest",
};

export type UnitFilter = "all" | "primary" | "ancillary";

export const UNIT_FILTER_LABELS: Record<UnitFilter, string> = {
  all: "All",
  primary: "Primary",
  ancillary: "Ancillary",
};

export const UNIT_FILTERS: UnitFilter[] = ["all", "primary", "ancillary"];

export type OwnerSortKey = "name" | "currentMonthly";

export const OWNER_SORT_LABELS: Record<OwnerSortKey, string> = {
  name: "Name",
  currentMonthly: "Current $/mo",
};

export type UnitTypeSortKey = "name" | "classification";

export const UNIT_TYPE_SORT_LABELS: Record<UnitTypeSortKey, string> = {
  name: "Name",
  classification: "Classification",
};

export type SortState<K> = { key: K; dir: "asc" | "desc" };

// Reorder `items` to match the saved id order. Items missing from `orderIds` keep their entry order
// at the end. The sort that produced `orderIds` ran on the prior display order, so a single-key
// sort cascades: equal values keep whatever order the previous sort left them in.
export function applyOrder<T>(items: T[], orderIds: string[], idOf: (item: T) => string): T[] {
  if (orderIds.length === 0) {
    return [...items];
  }
  const rank = new Map(orderIds.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(idOf(a)) ?? Number.POSITIVE_INFINITY) - (rank.get(idOf(b)) ?? Number.POSITIVE_INFINITY));
}

// Next direction when a sort key is clicked: a new/changed key starts asc, asc flips to desc, desc
// turns the sort off (null = back to entry order).
export function nextSortDir<K>(current: SortState<K> | undefined, key: K): "asc" | "desc" | null {
  if (!current || current.key !== key) {
    return "asc";
  }
  return current.dir === "asc" ? "desc" : null;
}

export function compareExpenses(a: Expense, b: Expense, key: ExpenseSortKey, dir: "asc" | "desc", policyName: Map<string, string>): number {
  const factor = dir === "asc" ? 1 : -1;
  if (key === "amount") {
    return (a.amount - b.amount) * factor;
  }
  const av = key === "name" ? a.name || "" : (policyName.get(a.policyId) ?? "");
  const bv = key === "name" ? b.name || "" : (policyName.get(b.policyId) ?? "");
  return av.localeCompare(bv) * factor;
}

export function compareUnits(a: Unit, b: Unit, key: UnitSortKey, dir: "asc" | "desc"): number {
  const factor = dir === "asc" ? 1 : -1;
  if (key === "ci") {
    return (a.commonInterest - b.commonInterest) * factor;
  }
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }) * factor;
}

export function compareOwners(a: Owner, b: Owner, key: OwnerSortKey, dir: "asc" | "desc"): number {
  const factor = dir === "asc" ? 1 : -1;
  if (key === "currentMonthly") {
    return (a.currentMonthly - b.currentMonthly) * factor;
  }
  return a.name.localeCompare(b.name) * factor;
}

export function compareUnitTypes(a: UnitType, b: UnitType, key: UnitTypeSortKey, dir: "asc" | "desc"): number {
  const factor = dir === "asc" ? 1 : -1;
  if (key === "classification") {
    return a.classification.localeCompare(b.classification) * factor;
  }
  return a.name.localeCompare(b.name) * factor;
}

// Reorder by the saved order (preserving cascade), then sort by `compare`, returning the new id order.
export function deriveOrder<T>(items: T[], prevOrder: string[], idOf: (item: T) => string, compare: (a: T, b: T) => number): string[] {
  const ordered = applyOrder(items, prevOrder, idOf);
  ordered.sort(compare);
  return ordered.map(idOf);
}

export type SortParam = {
  owner: SortState<OwnerSortKey> | null;
  unit: SortState<UnitSortKey> | null;
  unitType: SortState<UnitTypeSortKey> | null;
  expenses: Record<string, SortState<ExpenseSortKey>>;
};

// Sort state survives a refresh via the `s` URL param. Only the active key/dir per group is stored;
// the display order is re-derived on load (a single stored sort reproduces its order exactly).
// Token forms: `o:<key>:<dir>`, `u:<key>:<dir>`, `ut:<key>:<dir>`, `e:<encodedCategory>:<key>:<dir>`,
// joined by ",". encodeURIComponent escapes both ":" and "," so categories never collide with the delimiters.
export function serializeSortParam(
  owner: SortState<OwnerSortKey> | null,
  unit: SortState<UnitSortKey> | null,
  unitType: SortState<UnitTypeSortKey> | null,
  expenses: Record<string, SortState<ExpenseSortKey>>,
): string {
  const tokens: string[] = [];
  if (owner) {
    tokens.push(`o:${owner.key}:${owner.dir}`);
  }
  if (unit) {
    tokens.push(`u:${unit.key}:${unit.dir}`);
  }
  if (unitType) {
    tokens.push(`ut:${unitType.key}:${unitType.dir}`);
  }
  for (const [category, sort] of Object.entries(expenses)) {
    tokens.push(`e:${encodeURIComponent(category)}:${sort.key}:${sort.dir}`);
  }
  return tokens.join(",");
}

export function parseSortParam(raw: string): SortParam {
  const result: SortParam = { owner: null, unit: null, unitType: null, expenses: {} };
  for (const token of raw.split(",").filter(Boolean)) {
    const parts = token.split(":");
    if (parts[0] === "o" && parts.length === 3) {
      const [, key, dir] = parts;
      if ((key === "name" || key === "currentMonthly") && (dir === "asc" || dir === "desc")) {
        result.owner = { key, dir };
      }
    } else if (parts[0] === "u" && parts.length === 3) {
      const [, key, dir] = parts;
      if ((key === "label" || key === "ci") && (dir === "asc" || dir === "desc")) {
        result.unit = { key, dir };
      }
    } else if (parts[0] === "ut" && parts.length === 3) {
      const [, key, dir] = parts;
      if ((key === "name" || key === "classification") && (dir === "asc" || dir === "desc")) {
        result.unitType = { key, dir };
      }
    } else if (parts[0] === "e" && parts.length === 4) {
      const [, category, key, dir] = parts;
      if ((key === "name" || key === "amount" || key === "split") && (dir === "asc" || dir === "desc")) {
        result.expenses[decodeURIComponent(category)] = { key, dir };
      }
    }
  }
  return result;
}

// `classByType` resolves a unit's type name to its classification. Unknown types fail the
// primary/ancillary filter (the caller should usually surface them via warnings instead).
export function passesUnitFilter(
  unit: Unit,
  classByType: Map<string, UnitClassification>,
  unitFilter: UnitFilter,
  unitTypeFilter: Set<string>,
): boolean {
  if (unitTypeFilter.size > 0 && !unitTypeFilter.has(unit.type)) {
    return false;
  }
  if (unitFilter !== "all" && classByType.get(unit.type) !== unitFilter) {
    return false;
  }
  return true;
}

export function passesTypeFilter(type: UnitType, unitFilter: UnitFilter, unitTypeFilter: Set<string>): boolean {
  if (unitFilter !== "all" && type.classification !== unitFilter) {
    return false;
  }
  if (unitTypeFilter.size > 0 && !unitTypeFilter.has(type.name)) {
    return false;
  }
  return true;
}
