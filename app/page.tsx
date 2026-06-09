"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { computeCharges } from "../lib/allocate";
import { DEFAULT_BUDGET, makeId, validateBudget } from "../lib/budget";
import { formatCurrency } from "../lib/format";
import { parseOwnerLines, parseUnitLines, parseUnitTypeLines } from "../lib/parse";
import { exportBudgetJson, parseBudgetJson, parseBudgetUrl, serializeBudgetUrl } from "../lib/serialize";
import {
  applyOrder,
  compareExpenses,
  compareOwners,
  compareUnits,
  compareUnitTypes,
  deriveOrder,
  EXPENSE_SORT_LABELS,
  nextSortDir,
  OWNER_SORT_LABELS,
  parseSortParam,
  passesTypeFilter,
  passesUnitFilter,
  serializeSortParam,
  UNIT_FILTER_LABELS,
  UNIT_FILTERS,
  UNIT_SORT_LABELS,
  UNIT_TYPE_SORT_LABELS,
} from "../lib/sort";
import { ALLOCATION_METHOD_LABELS, ALLOCATION_METHODS, UNIT_CLASSIFICATION_LABELS, UNIT_CLASSIFICATIONS } from "../lib/types";
import type { UnitCharge } from "../lib/allocate";
import type { ExpenseSortKey, OwnerSortKey, SortState, UnitFilter, UnitSortKey, UnitTypeSortKey } from "../lib/sort";
import type { Budget, Owner, Unit, UnitClassification, UnitType } from "../lib/types";

const card = "rounded-3xl border border-[#e7d7c8] bg-white/80 p-6 shadow-[0_20px_60px_rgba(120,96,77,0.12)] backdrop-blur";
const sectionTitle = "text-2xl font-semibold text-[#181716]";
const sectionHint = "text-sm text-[#5b5148]";
const fieldBase =
  "h-10 rounded-xl border border-[#e6d7c7] bg-[#fefbf7] px-3 text-sm font-medium text-[#1d1b18] outline-none transition focus:border-[#c9a888] focus:ring-2 focus:ring-[#edc9a6]/60";
const field = `${fieldBase} w-full`;
const pillButton =
  "inline-flex items-center gap-2 rounded-full border border-[#1b1a17] px-4 py-2 text-sm font-semibold text-[#1b1a17] transition hover:-translate-y-0.5 hover:bg-[#f1e7db]";
const solidButton =
  "inline-flex items-center gap-2 rounded-full bg-[#1b1a17] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(30,27,23,0.2)] transition hover:-translate-y-0.5 hover:bg-[#2d2a25]";
const removeButton =
  "rounded-full border border-[#f0c8c6] px-3 py-1 text-xs font-semibold text-[#c0443c] transition hover:border-[#e9a8a4]";
const dangerButton =
  "inline-flex items-center gap-2 rounded-full border border-[#c0443c] px-4 py-2 text-sm font-semibold text-[#c0443c] transition hover:-translate-y-0.5 hover:bg-[#fbeae9]";
const groupHeading = "text-xs font-semibold uppercase tracking-[0.25em] text-[#8c7b6c]";
const iconButton =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8c7b5] text-[#5b5148] transition hover:-translate-y-0.5 hover:bg-[#f1e7db]";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "h-4 w-4",
} as const;

const TrashIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <rect x="6" y="7" width="12" height="14" rx="1.5" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

const SearchIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const formatCi = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function HomeContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"setup" | "rules">("setup");
  const [assignmentView, setAssignmentView] = useState<"type" | "owner">("type");
  const [unitFilter, setUnitFilter] = useState<UnitFilter>("all");
  const [unitTypeFilter, setUnitTypeFilter] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<"owner" | "unit" | "unitType" | null>(null);
  const collapsedInit = new Set((searchParams.get("c") ?? "").split(",").filter(Boolean));
  const [collapsedOwners, setCollapsedOwners] = useState(collapsedInit.has("owners"));
  const [collapsedUnits, setCollapsedUnits] = useState(collapsedInit.has("units"));
  const [collapsedAssignments, setCollapsedAssignments] = useState(collapsedInit.has("assignments"));
  const [collapsedPolicies, setCollapsedPolicies] = useState(collapsedInit.has("policies"));
  const [collapsedExpenses, setCollapsedExpenses] = useState(collapsedInit.has("expenses"));
  const [collapsedUnitTypes, setCollapsedUnitTypes] = useState(collapsedInit.has("unitTypes"));
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(
    () => new Set([...collapsedInit].filter((key) => key.startsWith("t:")).map((key) => decodeURIComponent(key.slice(2)))),
  );
  const [collapsedCharges, setCollapsedCharges] = useState<Set<string>>(new Set());
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [budget, setBudget] = useState<Budget>(() => parseBudgetUrl(searchParams.get("b")) ?? DEFAULT_BUDGET);
  const sortInit = parseSortParam(searchParams.get("s") ?? "");

  const encoded = useMemo(() => serializeBudgetUrl(budget), [budget]);
  const collapsedParam = [
    collapsedOwners && "owners",
    collapsedUnits && "units",
    collapsedAssignments && "assignments",
    collapsedUnitTypes && "unitTypes",
    collapsedPolicies && "policies",
    collapsedExpenses && "expenses",
    ...[...collapsedTypes].map((type) => `t:${encodeURIComponent(type)}`),
  ]
    .filter(Boolean)
    .join(",");
  const result = useMemo(() => computeCharges(budget), [budget]);
  const warnings = useMemo(() => validateBudget(budget), [budget]);
  const ciSum = budget.units.reduce((sum, unit) => sum + unit.commonInterest, 0);

  const patch = (updater: (draft: Budget) => Budget) => setBudget((prev) => updater(structuredClone(prev)));

  const handleExport = () => {
    const blob = new Blob([exportBudgetJson(budget)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "common-charges-budget.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseBudgetJson(typeof reader.result === "string" ? reader.result : "");
      if (parsed) {
        setBudget(parsed);
      }
    };
    reader.readAsText(file);
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const focusOwner = (id: string) => window.setTimeout(() => document.getElementById(`owner-name-${id}`)?.focus(), 0);

  // Add a new owner, focusing its name input once rendered.
  const addOwnerAndFocus = (name: string) => {
    const id = makeId("owner");
    patch((draft) => ({ ...draft, owners: [...draft.owners, { id, name, excluded: false, currentMonthly: 0 }] }));
    focusOwner(id);
  };

  const handleOwnerTab = (event: React.KeyboardEvent<HTMLInputElement>, isLast: boolean) => {
    if (event.key !== "Tab" || event.shiftKey || !isLast) {
      return;
    }
    event.preventDefault();
    addOwnerAndFocus("");
  };

  const applyBatchOwners = (owners: Owner[], replaceAll: boolean) =>
    patch((draft) => ({ ...draft, owners: replaceAll ? owners : [...draft.owners, ...owners] }));

  const applyBatchUnits = (units: Unit[], replaceAll: boolean) =>
    patch((draft) => ({ ...draft, units: replaceAll ? units : [...draft.units, ...units] }));

  const applyBatchUnitTypes = (unitTypes: UnitType[], replaceAll: boolean) =>
    patch((draft) => ({ ...draft, unitTypes: replaceAll ? unitTypes : [...draft.unitTypes, ...unitTypes] }));

  // Add a new unit type, focusing its name input once rendered. New names sort to the end of the
  // saved display order, so the focus index is the current count.
  const addUnitTypeAndFocus = (name: string) => {
    const index = budget.unitTypes.length;
    patch((draft) => ({ ...draft, unitTypes: [...draft.unitTypes, { name, classification: "primary" }] }));
    window.setTimeout(() => document.getElementById(`unittype-name-${index}`)?.focus(), 0);
  };

  const handleUnitTypeTab = (event: React.KeyboardEvent<HTMLInputElement>, isLast: boolean) => {
    if (event.key !== "Tab" || event.shiftKey || !isLast) {
      return;
    }
    event.preventDefault();
    addUnitTypeAndFocus("");
  };

  // Rename a unit type and carry the new name onto every reference (units, policy rules, offsets, and
  // the saved sort order), since types are referenced by name.
  const renameUnitType = (from: string, to: string) => {
    const next = to.trim();
    if (!next || next === from) {
      return;
    }
    patch((draft) => ({
      ...draft,
      unitTypes: draft.unitTypes.map((type) => (type.name === from ? { ...type, name: next } : type)),
      units: draft.units.map((unit) => (unit.type === from ? { ...unit, type: next } : unit)),
      policies: draft.policies.map((policy) => ({
        ...policy,
        rules: policy.rules.map((rule) => ({ ...rule, unitTypes: rule.unitTypes.map((type) => (type === from ? next : type)) })),
      })),
      adjustments: {
        ...draft.adjustments,
        offsets: (draft.adjustments.offsets ?? []).map((offset) => (offset.unitType === from ? { ...offset, unitType: next } : offset)),
      },
    }));
    setUnitTypeOrder((prev) => prev.map((name) => (name === from ? next : name)));
  };

  const addExpenseAndFocus = (category: string) => {
    const id = makeId("exp");
    patch((draft) => ({
      ...draft,
      expenses: [...draft.expenses, { id, name: "", category, amount: 0, policyId: draft.policies[0]?.id ?? "" }],
    }));
    window.setTimeout(() => document.getElementById(`expense-name-${id}`)?.focus(), 0);
  };

  const [dragCategory, setDragCategory] = useState<string | null>(null);
  const [dragPolicy, setDragPolicy] = useState<string | null>(null);
  // Per-category display sort. `expenseOrder` holds the saved id order per category (absent = entry
  // order); `expenseSort` just tracks the active key/dir for the arrow indicator. Clicking a key
  // cycles asc -> desc -> off. Each sort runs on the current display order, so sorting by one key
  // then another keeps the earlier sort as a stable tiebreaker.
  const [expenseSort, setExpenseSort] = useState<Record<string, SortState<ExpenseSortKey>>>(sortInit.expenses);
  const [expenseOrder, setExpenseOrder] = useState<Record<string, string[]>>(() => {
    const policyName = new Map(budget.policies.map((policy) => [policy.id, policy.name]));
    const orders: Record<string, string[]> = {};
    for (const [category, sort] of Object.entries(sortInit.expenses)) {
      orders[category] = deriveOrder(
        budget.expenses.filter((expense) => expense.category === category),
        [],
        (expense) => expense.id,
        (a, b) => compareExpenses(a, b, sort.key, sort.dir, policyName),
      );
    }
    return orders;
  });
  const cycleExpenseSort = (category: string, key: ExpenseSortKey) => {
    const dir = nextSortDir(expenseSort[category], key);
    if (dir === null) {
      setExpenseOrder((prev) => {
        const next = { ...prev };
        delete next[category];
        return next;
      });
      setExpenseSort((prev) => {
        const next = { ...prev };
        delete next[category];
        return next;
      });
      return;
    }
    const policyName = new Map(budget.policies.map((policy) => [policy.id, policy.name]));
    const order = deriveOrder(
      budget.expenses.filter((expense) => expense.category === category),
      expenseOrder[category] ?? [],
      (expense) => expense.id,
      (a, b) => compareExpenses(a, b, key, dir, policyName),
    );
    setExpenseOrder((prev) => ({ ...prev, [category]: order }));
    setExpenseSort((prev) => ({ ...prev, [category]: { key, dir } }));
  };
  // Display sort for units in the "by type" view. `unitOrder` is the saved id order across all units
  // (empty = entry order); sorting is applied within each type group at render. Same cascade rule.
  const [unitSort, setUnitSort] = useState<SortState<UnitSortKey> | null>(sortInit.unit);
  const [unitOrder, setUnitOrder] = useState<string[]>(() => {
    if (!sortInit.unit) {
      return [];
    }
    const { key, dir } = sortInit.unit;
    return deriveOrder(
      budget.units,
      [],
      (unit) => unit.id,
      (a, b) => compareUnits(a, b, key, dir),
    );
  });
  const cycleUnitSort = (key: UnitSortKey) => {
    const dir = nextSortDir(unitSort ?? undefined, key);
    if (dir === null) {
      setUnitOrder([]);
      setUnitSort(null);
      return;
    }
    setUnitOrder(
      deriveOrder(
        budget.units,
        unitOrder,
        (unit) => unit.id,
        (a, b) => compareUnits(a, b, key, dir),
      ),
    );
    setUnitSort({ key, dir });
  };
  // Display sort for the owners table. Same cascade rule as expenses and units.
  const [ownerSort, setOwnerSort] = useState<SortState<OwnerSortKey> | null>(sortInit.owner);
  const [ownerOrder, setOwnerOrder] = useState<string[]>(() => {
    if (!sortInit.owner) {
      return [];
    }
    const { key, dir } = sortInit.owner;
    return deriveOrder(
      budget.owners,
      [],
      (owner) => owner.id,
      (a, b) => compareOwners(a, b, key, dir),
    );
  });
  const cycleOwnerSort = (key: OwnerSortKey) => {
    const dir = nextSortDir(ownerSort ?? undefined, key);
    if (dir === null) {
      setOwnerOrder([]);
      setOwnerSort(null);
      return;
    }
    setOwnerOrder(
      deriveOrder(
        budget.owners,
        ownerOrder,
        (owner) => owner.id,
        (a, b) => compareOwners(a, b, key, dir),
      ),
    );
    setOwnerSort({ key, dir });
  };
  // Display sort for the unit types table. Same cascade rule as the other sections.
  const [unitTypeSort, setUnitTypeSort] = useState<SortState<UnitTypeSortKey> | null>(sortInit.unitType);
  const [unitTypeOrder, setUnitTypeOrder] = useState<string[]>(() => {
    if (!sortInit.unitType) {
      return [];
    }
    const { key, dir } = sortInit.unitType;
    return deriveOrder(
      budget.unitTypes,
      [],
      (type) => type.name,
      (a, b) => compareUnitTypes(a, b, key, dir),
    );
  });
  const cycleUnitTypeSort = (key: UnitTypeSortKey) => {
    const dir = nextSortDir(unitTypeSort ?? undefined, key);
    if (dir === null) {
      setUnitTypeOrder([]);
      setUnitTypeSort(null);
      return;
    }
    setUnitTypeOrder(
      deriveOrder(
        budget.unitTypes,
        unitTypeOrder,
        (type) => type.name,
        (a, b) => compareUnitTypes(a, b, key, dir),
      ),
    );
    setUnitTypeSort({ key, dir });
  };

  const sortParam = serializeSortParam(ownerSort, unitSort, unitTypeSort, expenseSort);
  useEffect(
    function syncUrlState() {
      if (
        (searchParams.get("b") ?? "") === encoded &&
        (searchParams.get("c") ?? "") === collapsedParam &&
        (searchParams.get("s") ?? "") === sortParam
      ) {
        return;
      }
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("b", encoded);
      if (collapsedParam) {
        nextParams.set("c", collapsedParam);
      } else {
        nextParams.delete("c");
      }
      if (sortParam) {
        nextParams.set("s", sortParam);
      } else {
        nextParams.delete("s");
      }
      window.history.replaceState(null, "", `${pathname}?${nextParams.toString()}`);
    },
    [encoded, collapsedParam, sortParam, pathname, searchParams],
  );

  const toggleType = (key: string) =>
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  // Reorder by id: move the item with `fromId` to sit just before (or after, when `after`) `toId`.
  // Single pass collects the moved item and the target's landing index, then one splice inserts it.
  const moveItem = <T extends { id: string }>(arr: T[], fromId: string, toId: string, after: boolean): T[] => {
    if (fromId === toId) {
      return arr;
    }
    const next: T[] = [];
    let item: T | undefined;
    let insertAt = -1;
    for (const value of arr) {
      if (value.id === fromId) {
        item = value;
        continue;
      }
      if (value.id === toId) {
        insertAt = after ? next.length + 1 : next.length;
      }
      next.push(value);
    }
    if (!item) {
      return arr;
    }
    next.splice(insertAt < 0 ? next.length : insertAt, 0, item);
    return next;
  };

  const movePolicy = (from: string, to: string, after: boolean) =>
    patch((draft) => ({ ...draft, policies: moveItem(draft.policies, from, to, after) }));

  // True when the drag pointer is past the vertical midpoint of the hovered row (insert after, not before).
  const isAfterMidpoint = (event: React.DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  };

  const moveCategory = (from: string, to: string, after: boolean) => {
    if (from === to) {
      return;
    }
    patch((draft) => {
      const next = draft.categories.filter((c) => c !== from);
      const idx = next.indexOf(to);
      next.splice(after ? idx + 1 : idx, 0, from);
      return { ...draft, categories: next };
    });
  };

  // Rename a category and carry the new name onto every expense that used it.
  const renameCategory = (from: string, to: string) => {
    if (from === to) {
      return;
    }
    patch((draft) => ({
      ...draft,
      categories: draft.categories.map((c) => (c === from ? to : c)),
      expenses: draft.expenses.map((e) => (e.category === from ? { ...e, category: to } : e)),
    }));
  };

  const renderUnitRow = (unit: Unit) => {
    return (
      <div key={unit.id} className="grid gap-2 transition-opacity sm:grid-cols-[1.4fr_1.2fr_1fr_auto] sm:items-center">
        <TextField
          className={field}
          value={unit.label}
          onChange={(next) =>
            patch((draft) => ({ ...draft, units: draft.units.map((u) => (u.id === unit.id ? { ...u, label: next } : u)) }))
          }
        />
        <select
          className={field}
          value={unit.type}
          onChange={(event) =>
            patch((draft) => ({ ...draft, units: draft.units.map((u) => (u.id === unit.id ? { ...u, type: event.target.value } : u)) }))
          }
        >
          {budget.unitTypes.map((type) => (
            <option key={type.name} value={type.name}>
              {type.name}
            </option>
          ))}
        </select>
        <CiInput
          className={field}
          value={unit.commonInterest}
          onChange={(next) =>
            patch((draft) => ({
              ...draft,
              units: draft.units.map((u) => (u.id === unit.id ? { ...u, commonInterest: next } : u)),
            }))
          }
        />
        <button
          type="button"
          className={removeButton}
          onClick={() => patch((draft) => ({ ...draft, units: draft.units.filter((u) => u.id !== unit.id) }))}
        >
          Remove
        </button>
      </div>
    );
  };

  const renderAssignmentRow = (unit: Unit) => {
    return (
      <div key={unit.id} className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-sm font-medium text-[#1d1b18]">{unit.label || "—"}</span>
        <select
          className={`${field} max-w-xs flex-1`}
          value={unit.ownerId}
          onChange={(event) =>
            patch((draft) => ({ ...draft, units: draft.units.map((u) => (u.id === unit.id ? { ...u, ownerId: event.target.value } : u)) }))
          }
        >
          <option value="">— unassigned —</option>
          {budget.owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>
      </div>
    );
  };

  // Order units within a type group by the saved display order.
  const sortUnits = (units: Unit[]): Unit[] => applyOrder(units, unitOrder, (unit) => unit.id);

  const classByType = new Map(budget.unitTypes.map((type) => [type.name, type.classification]));
  const unitPasses = (unit: Unit) => passesUnitFilter(unit, classByType, unitFilter, unitTypeFilter);
  const typePasses = (type: UnitType) => passesTypeFilter(type, unitFilter, unitTypeFilter);

  const unitGroups: { key: string; label: string; classification: UnitClassification; units: Unit[] }[] = budget.unitTypes
    .filter(typePasses)
    .map((type) => ({
      key: type.name,
      label: type.name,
      classification: type.classification,
      units: sortUnits(budget.units.filter((unit) => unit.type === type.name)),
    }));

  const assignmentByTypeGroups: { key: string; label: string; classification: UnitClassification; units: Unit[] }[] = budget.unitTypes
    .filter(typePasses)
    .map((type) => ({
      key: `a:t:${type.name}`,
      label: type.name,
      classification: type.classification,
      units: sortUnits(budget.units.filter((unit) => unit.type === type.name)),
    }));

  const assignmentByOwnerGroups: { key: string; owner: Owner; units: Unit[]; primaryUnits: Unit[]; totalCi: number }[] = budget.owners.map(
    (owner) => {
      const ownerUnits = budget.units.filter((unit) => unit.ownerId === owner.id);
      const visible = sortUnits(ownerUnits.filter(unitPasses));
      const primaryUnits = ownerUnits.filter((unit) => classByType.get(unit.type) === "primary");
      const totalCi = visible.reduce((sum, unit) => sum + unit.commonInterest, 0);
      return { key: `a:o:${owner.id}`, owner, units: visible, primaryUnits, totalCi };
    },
  );

  const unassignedUnits = sortUnits(budget.units.filter((unit) => !unit.ownerId && unitPasses(unit)));

  const assignmentGroupKeys =
    assignmentView === "type" ? assignmentByTypeGroups.map((group) => group.key) : assignmentByOwnerGroups.map((group) => group.key);
  const allAssignmentsCollapsed = assignmentGroupKeys.length > 0 && assignmentGroupKeys.every((key) => collapsedTypes.has(key));
  const toggleAllAssignments = () =>
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (allAssignmentsCollapsed) {
        for (const key of assignmentGroupKeys) {
          next.delete(key);
        }
      } else {
        for (const key of assignmentGroupKeys) {
          next.add(key);
        }
      }
      return next;
    });

  const allChargesCollapsed = result.perOwner.length > 0 && result.perOwner.every((o) => collapsedCharges.has(o.ownerId));
  const toggleAllCharges = () =>
    setCollapsedCharges((prev) => {
      const next = new Set(prev);
      if (allChargesCollapsed) {
        for (const o of result.perOwner) next.delete(o.ownerId);
      } else {
        for (const o of result.perOwner) next.add(o.ownerId);
      }
      return next;
    });

  const expenseCategories = [...new Set([...budget.categories, ...budget.expenses.map((expense) => expense.category)])];
  const catKey = (cat: string) => `e:${cat}`;
  const allCategoriesCollapsed = expenseCategories.length > 0 && expenseCategories.every((cat) => collapsedTypes.has(catKey(cat)));
  const toggleAllCategories = () =>
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (allCategoriesCollapsed) {
        for (const cat of expenseCategories) next.delete(catKey(cat));
      } else {
        for (const cat of expenseCategories) next.add(catKey(cat));
      }
      return next;
    });

  const unitsByOwner = new Map<string, UnitCharge[]>();
  for (const charge of result.perUnit) {
    const list = unitsByOwner.get(charge.ownerId) ?? [];
    list.push(charge);
    unitsByOwner.set(charge.ownerId, list);
  }
  const expenseName = new Map(budget.expenses.map((expense) => [expense.id, expense.name || "(unnamed)"]));

  const sortedPerOwner = [...result.perOwner].sort((a, b) => {
    const unitLabel = (ownerId: string, classification: "primary" | "ancillary") => {
      const unit = budget.units.find((u) => u.ownerId === ownerId && classByType.get(u.type) === classification);
      return unit?.label ?? null;
    };
    const aLabel = unitLabel(a.ownerId, "primary") ?? unitLabel(a.ownerId, "ancillary") ?? "￿";
    const bLabel = unitLabel(b.ownerId, "primary") ?? unitLabel(b.ownerId, "ancillary") ?? "￿";
    return aLabel.localeCompare(bLabel, undefined, { numeric: true });
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f7f1e8]">
      <div className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-[#f0c9a7]/60 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-24 h-80 w-80 rounded-full bg-[#b6d6cf]/60 blur-3xl" />

      <main className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-16 sm:px-10 lg:px-12">
        <header className="flex flex-col gap-5">
          <div className="text-sm uppercase tracking-[0.3em] text-[#7b6a5b]">Common Charges Calculator</div>
          <h1 className="text-4xl font-semibold tracking-tight text-[#161515] sm:text-5xl">Split building expenses fairly.</h1>
          <p className="max-w-3xl text-base text-[#4a4037] sm:text-lg">
            Define owners, units, expenses, and the policies that decide how each expense is split. Charges update instantly. Everything
            runs locally in your browser and is stored in the URL, so you can bookmark or share a budget.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={solidButton} onClick={handleCopyLink}>
              {copied ? "Link copied" : "Copy share link"}
            </button>
            <button type="button" className={pillButton} onClick={handleExport}>
              Export JSON
            </button>
            <button type="button" className={pillButton} onClick={() => fileInputRef.current?.click()}>
              Import JSON
            </button>
            <button type="button" className={pillButton} onClick={() => setBudget(structuredClone(DEFAULT_BUDGET))}>
              Reset to sample
            </button>
            <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleImport} className="hidden" />
          </div>
        </header>

        {warnings.length > 0 ? (
          <section className="rounded-2xl border border-[#eccfa3] bg-[#fff6e6] p-4 text-sm text-[#7a5a23]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em]">Warnings</p>
            <ul className="mt-2 list-disc pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <nav className="flex flex-wrap gap-2">
          {(
            [
              ["setup", "Owners & units"],
              ["rules", "Calculator"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                activeTab === key
                  ? "border-[#1b1a17] bg-[#1b1a17] text-white"
                  : "border-[#d8c7b5] text-[#5b5148] hover:-translate-y-0.5 hover:bg-[#f1e7db]"
              }`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === "setup" ? (
          <>
            {/* Owners */}
            <section className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={`${sectionTitle} flex items-center gap-2`}
                  onClick={() => setCollapsedOwners((value) => !value)}
                >
                  <span className="text-2xl leading-none text-[#8c7b6c]">{collapsedOwners ? "▸" : "▾"}</span>
                  Owners
                  <span className="text-sm font-normal text-[#9a8a7b]">({budget.owners.length})</span>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  {budget.owners.length > 1 ? (
                    <div className="flex items-center gap-2">
                      <span className={groupHeading}>Sort by</span>
                      <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                        {(["name", "currentMonthly"] as OwnerSortKey[]).map((key) => {
                          const active = ownerSort?.key === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`px-3 py-1.5 ${active ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                              aria-label={`Sort owners by ${OWNER_SORT_LABELS[key].toLowerCase()}${active ? ` (${ownerSort.dir === "asc" ? "ascending" : "descending"})` : ""}`}
                              onClick={() => cycleOwnerSort(key)}
                            >
                              {OWNER_SORT_LABELS[key]}
                              {active ? (ownerSort.dir === "asc" ? " ↑" : " ↓") : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <button type="button" className={pillButton} onClick={() => addOwnerAndFocus("New owner")}>
                    Add owner
                  </button>
                  <button type="button" className={pillButton} onClick={() => setBatch("owner")}>
                    Batch add
                  </button>
                  <button type="button" className={dangerButton} onClick={() => patch((draft) => ({ ...draft, owners: [] }))}>
                    Delete all
                  </button>
                </div>
              </div>
              {collapsedOwners ? null : (
                <>
                  <p className={`${sectionHint} mt-1`}>
                    Add all owners here with 'Add owner', batch upload, or the Tab key. Mark an owner as 'excluded' and their Units don't
                    pay common charges (example: if the condo board owns units).
                  </p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[#eadccb] text-left text-xs font-semibold uppercase tracking-[0.2em] text-[#8c7b6c]">
                          <th className="py-2 pr-4">Owner name</th>
                          <th className="py-2 pr-4">Current $/mo</th>
                          <th className="py-2 pl-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {applyOrder(budget.owners, ownerOrder, (owner) => owner.id).map((owner, index) => {
                          return (
                            <tr key={owner.id} className="border-b border-[#f2e8dd]">
                              <td className="py-2 pr-4 align-middle">
                                <TextField
                                  id={`owner-name-${owner.id}`}
                                  className={field}
                                  value={owner.name}
                                  onChange={(next) =>
                                    patch((draft) => ({
                                      ...draft,
                                      owners: draft.owners.map((o) => (o.id === owner.id ? { ...o, name: next } : o)),
                                    }))
                                  }
                                  onKeyDown={(event) => handleOwnerTab(event, index === budget.owners.length - 1)}
                                />
                              </td>
                              <td className="py-2 pr-4 align-middle">
                                <CurrencyField
                                  className={`${fieldBase} w-28`}
                                  value={owner.currentMonthly}
                                  onChange={(next) =>
                                    patch((draft) => ({
                                      ...draft,
                                      owners: draft.owners.map((o) => (o.id === owner.id ? { ...o, currentMonthly: next } : o)),
                                    }))
                                  }
                                />
                              </td>
                              <td className="py-2 pl-4 align-middle">
                                <div className="flex items-center justify-end gap-2">
                                  <label className="flex items-center gap-1 whitespace-nowrap text-xs text-[#4a4037]">
                                    <input
                                      type="checkbox"
                                      checked={owner.excluded}
                                      onChange={(event) =>
                                        patch((draft) => ({
                                          ...draft,
                                          owners: draft.owners.map((o) =>
                                            o.id === owner.id ? { ...o, excluded: event.target.checked } : o,
                                          ),
                                        }))
                                      }
                                    />
                                    Excluded
                                  </label>
                                  <button
                                    type="button"
                                    className={`${iconButton} border-[#f0c8c6] text-[#c0443c] hover:border-[#e9a8a4]`}
                                    aria-label="Remove owner"
                                    onClick={() => patch((draft) => ({ ...draft, owners: draft.owners.filter((o) => o.id !== owner.id) }))}
                                  >
                                    <TrashIcon />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-[#eadccb] pt-3 text-sm font-semibold text-[#181716]">
                    <span>Total income</span>
                    <span>{formatCurrency(budget.owners.reduce((sum, owner) => sum + owner.currentMonthly * 12, 0))}/yr</span>
                  </div>
                </>
              )}
            </section>

            {/* Unit types */}
            <section className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={`${sectionTitle} flex items-center gap-2`}
                  onClick={() => setCollapsedUnitTypes((value) => !value)}
                >
                  <span className="text-2xl leading-none text-[#8c7b6c]">{collapsedUnitTypes ? "▸" : "▾"}</span>
                  Unit types
                  <span className="text-sm font-normal text-[#9a8a7b]">({budget.unitTypes.length})</span>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  {budget.unitTypes.length > 1 ? (
                    <div className="flex items-center gap-2">
                      <span className={groupHeading}>Sort by</span>
                      <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                        {(["name", "classification"] as UnitTypeSortKey[]).map((key) => {
                          const active = unitTypeSort?.key === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`px-3 py-1.5 ${active ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                              aria-label={`Sort unit types by ${UNIT_TYPE_SORT_LABELS[key].toLowerCase()}${active ? ` (${unitTypeSort.dir === "asc" ? "ascending" : "descending"})` : ""}`}
                              onClick={() => cycleUnitTypeSort(key)}
                            >
                              {UNIT_TYPE_SORT_LABELS[key]}
                              {active ? (unitTypeSort.dir === "asc" ? " ↑" : " ↓") : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <button type="button" className={pillButton} onClick={() => addUnitTypeAndFocus("New type")}>
                    Add unit type
                  </button>
                  <button type="button" className={pillButton} onClick={() => setBatch("unitType")}>
                    Batch add
                  </button>
                  <button type="button" className={dangerButton} onClick={() => patch((draft) => ({ ...draft, unitTypes: [] }))}>
                    Delete all
                  </button>
                </div>
              </div>
              {collapsedUnitTypes ? null : (
                <>
                  <p className={`${sectionHint} mt-1`}>
                    Unit types are referenced by units, policies, and offsets. Classification (Primary or Ancillary) is for bookkeeping only
                    and does not affect charges yet.
                  </p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[#eadccb] text-left text-xs font-semibold uppercase tracking-[0.2em] text-[#8c7b6c]">
                          <th className="py-2 pr-4">Type name</th>
                          <th className="py-2 pr-4">Classification</th>
                          <th className="py-2 pl-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {applyOrder(budget.unitTypes, unitTypeOrder, (type) => type.name).map((type, index) => (
                          <tr key={type.name} className="border-b border-[#f2e8dd]">
                            <td className="py-2 pr-4 align-middle">
                              <TextField
                                id={`unittype-name-${index}`}
                                className={field}
                                value={type.name}
                                onChange={(next) => renameUnitType(type.name, next)}
                                onKeyDown={(event) => handleUnitTypeTab(event, index === budget.unitTypes.length - 1)}
                              />
                            </td>
                            <td className="py-2 pr-4 align-middle">
                              <select
                                className={`${fieldBase} w-40`}
                                value={type.classification}
                                onChange={(event) =>
                                  patch((draft) => ({
                                    ...draft,
                                    unitTypes: draft.unitTypes.map((t) =>
                                      t.name === type.name ? { ...t, classification: event.target.value as UnitClassification } : t,
                                    ),
                                  }))
                                }
                              >
                                {UNIT_CLASSIFICATIONS.map((classification) => (
                                  <option key={classification} value={classification}>
                                    {UNIT_CLASSIFICATION_LABELS[classification]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 pl-4 align-middle">
                              <div className="flex items-center justify-end">
                                <button
                                  type="button"
                                  className={`${iconButton} border-[#f0c8c6] text-[#c0443c] hover:border-[#e9a8a4]`}
                                  aria-label="Remove unit type"
                                  onClick={() =>
                                    patch((draft) => ({ ...draft, unitTypes: draft.unitTypes.filter((t) => t.name !== type.name) }))
                                  }
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {budget.unitTypes.length === 0 ? <p className="mt-3 text-sm italic text-[#9a8a7b]">No unit types.</p> : null}
                  </div>
                </>
              )}
            </section>

            {/* Units */}
            <section className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={`${sectionTitle} flex items-center gap-2`}
                  onClick={() => setCollapsedUnits((value) => !value)}
                >
                  <span className="text-2xl leading-none text-[#8c7b6c]">{collapsedUnits ? "▸" : "▾"}</span>
                  Units
                  <span className="text-sm font-normal text-[#9a8a7b]">({budget.units.length})</span>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={pillButton}
                    onClick={() =>
                      patch((draft) => ({
                        ...draft,
                        units: [
                          ...draft.units,
                          {
                            id: makeId("unit"),
                            label: "New unit",
                            type: draft.unitTypes[0]?.name ?? "",
                            commonInterest: 0,
                            ownerId: draft.owners[0]?.id ?? "",
                          },
                        ],
                      }))
                    }
                  >
                    Add unit
                  </button>
                  <button type="button" className={pillButton} onClick={() => setBatch("unit")}>
                    Batch add
                  </button>
                  <button type="button" className={dangerButton} onClick={() => patch((draft) => ({ ...draft, units: [] }))}>
                    Delete all
                  </button>
                </div>
              </div>
              {collapsedUnits ? null : (
                <>
                  <p className={`${sectionHint} mt-1`}>
                    Common interests total{" "}
                    <span className={Math.abs(ciSum - 100) <= 0.01 ? "font-semibold text-[#3f7a52]" : "font-semibold text-[#b44b43]"}>
                      {formatCi(ciSum)}%
                    </span>{" "}
                    (should be as close to 100% as possible). Columns: label, type, common interest %. Grouped by unit type. Edit owner
                    assignments in the Assignments section below.
                    {Math.abs(ciSum - 100) > 0.01 ? (
                      <span className="font-semibold text-[#b44b43]"> Off from 100% - double-check the Unit definitions.</span>
                    ) : null}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                    <div className="flex items-center gap-2">
                      <span className={groupHeading}>Filter</span>
                      <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                        {UNIT_FILTERS.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={`px-3 py-1.5 ${unitFilter === value ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                            onClick={() => setUnitFilter(value)}
                          >
                            {UNIT_FILTER_LABELS[value]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {budget.unitTypes.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className={groupHeading}>Types</span>
                        <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                          <button
                            type="button"
                            className={`px-3 py-1.5 ${unitTypeFilter.size === 0 ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                            onClick={() => setUnitTypeFilter(new Set())}
                          >
                            All
                          </button>
                          {budget.unitTypes.map((type) => {
                            const active = unitTypeFilter.has(type.name);
                            return (
                              <button
                                key={type.name}
                                type="button"
                                aria-pressed={active}
                                className={`px-3 py-1.5 ${active ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                                onClick={() =>
                                  setUnitTypeFilter((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(type.name)) {
                                      next.delete(type.name);
                                    } else {
                                      next.add(type.name);
                                    }
                                    return next;
                                  })
                                }
                              >
                                {type.name || "—"}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <span className={groupHeading}>Sort by</span>
                      <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                        {(["label", "ci"] as UnitSortKey[]).map((key) => {
                          const active = unitSort?.key === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`px-3 py-1.5 ${active ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                              aria-label={`Sort units by ${UNIT_SORT_LABELS[key].toLowerCase()}${active ? ` (${unitSort.dir === "asc" ? "ascending" : "descending"})` : ""}`}
                              onClick={() => cycleUnitSort(key)}
                            >
                              {UNIT_SORT_LABELS[key]}
                              {active ? (unitSort.dir === "asc" ? " ↑" : " ↓") : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-5">
                    {unitGroups.map((group) => {
                      const groupCi = group.units.reduce((sum, unit) => sum + unit.commonInterest, 0);
                      const collapsed = collapsedTypes.has(group.key);
                      return (
                        <div key={group.key} className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <button type="button" className="flex items-center gap-2" onClick={() => toggleType(group.key)}>
                              <span className="text-lg leading-none text-[#8c7b6c]">{collapsed ? "▸" : "▾"}</span>
                              <span className={groupHeading}>{group.label || "—"}</span>
                            </button>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full border border-[#e6d7c7] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8c7b6c]">
                                {UNIT_CLASSIFICATION_LABELS[group.classification]}
                              </span>
                              <span className="text-xs text-[#9a8a7b]">{formatCi(groupCi)}%</span>
                            </div>
                          </div>
                          {collapsed ? null : group.units.length === 0 ? (
                            <p className="text-sm italic text-[#9a8a7b]">No units.</p>
                          ) : (
                            <div className="space-y-2 lg:columns-2 lg:gap-x-6 lg:space-y-0">
                              {group.units.map((unit) => (
                                <div key={unit.id} className="mb-2 break-inside-avoid">
                                  {renderUnitRow(unit)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            {/* Assignments */}
            <section className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={`${sectionTitle} flex items-center gap-2`}
                  onClick={() => setCollapsedAssignments((value) => !value)}
                >
                  <span className="text-2xl leading-none text-[#8c7b6c]">{collapsedAssignments ? "▸" : "▾"}</span>
                  Assignments
                  <span className="text-sm font-normal text-[#9a8a7b]">({budget.units.length})</span>
                </button>
                {!collapsedAssignments && assignmentGroupKeys.length > 0 ? (
                  <button type="button" className={pillButton} onClick={toggleAllAssignments}>
                    {allAssignmentsCollapsed ? "Expand all" : "Collapse all"}
                  </button>
                ) : null}
              </div>
              {collapsedAssignments ? null : (
                <>
                  <p className={`${sectionHint} mt-1`}>Assign an owner to each unit. Change a unit's type in the Units section above.</p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                    <div className="flex items-center gap-2">
                      <span className={groupHeading}>Grouping</span>
                      <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                        <button
                          type="button"
                          className={`px-3 py-1.5 ${assignmentView === "type" ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                          onClick={() => setAssignmentView("type")}
                        >
                          By type
                        </button>
                        <button
                          type="button"
                          className={`px-3 py-1.5 ${assignmentView === "owner" ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                          onClick={() => setAssignmentView("owner")}
                        >
                          By owner
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={groupHeading}>Filter</span>
                      <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                        {UNIT_FILTERS.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={`px-3 py-1.5 ${unitFilter === value ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                            onClick={() => setUnitFilter(value)}
                          >
                            {UNIT_FILTER_LABELS[value]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {budget.unitTypes.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className={groupHeading}>Types</span>
                        <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                          <button
                            type="button"
                            className={`px-3 py-1.5 ${unitTypeFilter.size === 0 ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                            onClick={() => setUnitTypeFilter(new Set())}
                          >
                            All
                          </button>
                          {budget.unitTypes.map((type) => {
                            const active = unitTypeFilter.has(type.name);
                            return (
                              <button
                                key={type.name}
                                type="button"
                                aria-pressed={active}
                                className={`px-3 py-1.5 ${active ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                                onClick={() =>
                                  setUnitTypeFilter((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(type.name)) {
                                      next.delete(type.name);
                                    } else {
                                      next.add(type.name);
                                    }
                                    return next;
                                  })
                                }
                              >
                                {type.name || "—"}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <span className={groupHeading}>Sort by</span>
                      <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                        {(["label", "ci"] as UnitSortKey[]).map((key) => {
                          const active = unitSort?.key === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`px-3 py-1.5 ${active ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                              aria-label={`Sort units by ${UNIT_SORT_LABELS[key].toLowerCase()}${active ? ` (${unitSort.dir === "asc" ? "ascending" : "descending"})` : ""}`}
                              onClick={() => cycleUnitSort(key)}
                            >
                              {UNIT_SORT_LABELS[key]}
                              {active ? (unitSort.dir === "asc" ? " ↑" : " ↓") : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {assignmentView === "type" ? (
                    <div className="mt-4 flex flex-col gap-5">
                      {assignmentByTypeGroups.map((group) => {
                        const collapsed = collapsedTypes.has(group.key);
                        return (
                          <div key={group.key} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <button type="button" className="flex items-center gap-2" onClick={() => toggleType(group.key)}>
                                <span className="text-lg leading-none text-[#8c7b6c]">{collapsed ? "▸" : "▾"}</span>
                                <span className={groupHeading}>{group.label || "—"}</span>
                              </button>
                              <div className="flex items-center gap-2">
                                <span className="rounded-full border border-[#e6d7c7] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8c7b6c]">
                                  {UNIT_CLASSIFICATION_LABELS[group.classification]}
                                </span>
                                <span className="text-xs text-[#9a8a7b]">{group.units.length}</span>
                              </div>
                            </div>
                            {collapsed ? null : group.units.length === 0 ? (
                              <p className="text-sm italic text-[#9a8a7b]">No units.</p>
                            ) : (
                              <div className="space-y-2 lg:columns-2 lg:gap-x-6 lg:space-y-0">
                                {group.units.map((unit) => (
                                  <div key={unit.id} className="mb-2 break-inside-avoid">
                                    {renderAssignmentRow(unit)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-col gap-5">
                      {assignmentByOwnerGroups.map((group) => {
                        const collapsed = collapsedTypes.has(group.key);
                        const primaryLabels = group.primaryUnits.map((unit) => unit.label || "—").join(", ");
                        return (
                          <div key={group.key} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <button type="button" className="flex items-center gap-2" onClick={() => toggleType(group.key)}>
                                <span className="text-lg leading-none text-[#8c7b6c]">{collapsed ? "▸" : "▾"}</span>
                                {group.primaryUnits.length > 0 ? (
                                  <span
                                    className="rounded-full border border-[#e6d7c7] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8c7b6c]"
                                    title="Primary units"
                                  >
                                    {primaryLabels}
                                  </span>
                                ) : null}
                                <span className={groupHeading}>{group.owner.name || "—"}</span>
                              </button>
                              <span className="text-xs text-[#9a8a7b]">{formatCi(group.totalCi)}%</span>
                            </div>
                            {collapsed ? null : (
                              <div className="flex flex-col gap-1.5">
                                {group.units.length === 0 ? (
                                  <p className="text-sm italic text-[#9a8a7b]">No units.</p>
                                ) : (
                                  group.units.map((unit) => (
                                    <div key={unit.id} className="flex items-center gap-3">
                                      <span className="w-20 shrink-0 text-sm font-medium text-[#1d1b18]">{unit.label || "—"}</span>
                                      <span className="w-24 shrink-0 text-sm text-[#5b5148]">{formatCi(unit.commonInterest)}%</span>
                                      <button
                                        type="button"
                                        aria-label={`Remove unit ${unit.label} from owner`}
                                        className="flex h-6 w-6 items-center justify-center rounded-full border border-[#f0c8c6] text-[#c0443c] transition hover:border-[#e9a8a4]"
                                        onClick={() =>
                                          patch((draft) => ({
                                            ...draft,
                                            units: draft.units.map((u) => (u.id === unit.id ? { ...u, ownerId: "" } : u)),
                                          }))
                                        }
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))
                                )}
                                {unassignedUnits.length > 0 ? (
                                  <div className="mt-1 flex items-center gap-2">
                                    <span className="text-xs text-[#9a8a7b]">Add unit:</span>
                                    <select
                                      className={`${field} max-w-xs`}
                                      value=""
                                      onChange={(event) => {
                                        const id = event.target.value;
                                        if (!id) {
                                          return;
                                        }
                                        patch((draft) => ({
                                          ...draft,
                                          units: draft.units.map((u) => (u.id === id ? { ...u, ownerId: group.owner.id } : u)),
                                        }));
                                      }}
                                    >
                                      <option value="">— select —</option>
                                      {unassignedUnits.map((unit) => (
                                        <option key={unit.id} value={unit.id}>
                                          {unit.label || "—"} ({unit.type})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : null}

        {activeTab === "rules" ? (
          <>
            {/* Policies */}
            <section className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={`${sectionTitle} flex items-center gap-2`}
                  onClick={() => setCollapsedPolicies((value) => !value)}
                >
                  <span className="text-2xl leading-none text-[#8c7b6c]">{collapsedPolicies ? "▸" : "▾"}</span>
                  Policies
                  <span className="text-sm font-normal text-[#9a8a7b]">({budget.policies.length})</span>
                </button>
                <button
                  type="button"
                  className={pillButton}
                  onClick={() =>
                    patch((draft) => ({
                      ...draft,
                      policies: [
                        ...draft.policies,
                        { id: makeId("policy"), name: "New policy", rules: [{ unitTypes: [], weight: 100, method: "common_interest" }] },
                      ],
                    }))
                  }
                >
                  Add policy
                </button>
              </div>
              {collapsedPolicies ? null : (
                <>
                  <p className={`${sectionHint} mt-1`}>
                    Each rule takes an allocation % of the expense and splits it among the selected unit types.
                  </p>
                  <div className="mt-4 flex flex-col gap-4">
                    {budget.policies.map((policy) => {
                      const weightSum = policy.rules.reduce((sum, rule) => sum + rule.weight, 0);
                      return (
                        // biome-ignore lint/a11y/noStaticElementInteractions: native drag-and-drop reorder target
                        <div
                          key={policy.id}
                          data-policy={policy.id}
                          className={`rounded-2xl border border-[#f2e8dd] bg-[#fffaf3] p-4 transition-opacity ${dragPolicy === policy.id ? "opacity-40" : ""}`}
                          onDragOver={(event) => {
                            if (dragPolicy) {
                              event.preventDefault();
                              if (dragPolicy !== policy.id) {
                                movePolicy(dragPolicy, policy.id, isAfterMidpoint(event));
                              }
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            setDragPolicy(null);
                          }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
                              <span
                                draggable
                                onDragStart={(event) => {
                                  setDragPolicy(policy.id);
                                  const card = (event.currentTarget as HTMLElement).closest("[data-policy]");
                                  if (card) {
                                    event.dataTransfer.setDragImage(card, 20, 16);
                                  }
                                }}
                                onDragEnd={() => setDragPolicy(null)}
                                className="cursor-grab select-none text-[#b3a392]"
                                title="Drag to reorder policy"
                              >
                                ☰
                              </span>
                              <TextField
                                className={`${field} max-w-sm`}
                                value={policy.name}
                                onChange={(next) =>
                                  patch((draft) => ({
                                    ...draft,
                                    policies: draft.policies.map((p) => (p.id === policy.id ? { ...p, name: next } : p)),
                                  }))
                                }
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <span
                                className={
                                  Math.abs(weightSum - 100) <= 0.01 ? "text-xs text-[#3f7a52]" : "text-xs font-semibold text-[#b44b43]"
                                }
                              >
                                total: {weightSum}%
                              </span>
                              <button
                                type="button"
                                className={`${iconButton} border-[#f0c8c6] text-[#c0443c] hover:border-[#e9a8a4]`}
                                aria-label="Remove policy"
                                onClick={() => patch((draft) => ({ ...draft, policies: draft.policies.filter((p) => p.id !== policy.id) }))}
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-[#5b5148]">
                            {(() => {
                              const used = budget.expenses.filter((e) => e.policyId === policy.id).map((e) => e.name || "(unnamed)");
                              return used.length > 0 ? `Used by: ${used.join(", ")}` : "Not used by any expense.";
                            })()}
                          </p>
                          <div className="mt-3 flex flex-col gap-3">
                            {policy.rules.map((rule, ruleIndex) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: rules are positional and have no stable id
                              <div key={`${policy.id}-rule-${ruleIndex}`} className="rounded-xl border border-[#eee0d1] bg-white/70 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-[#4a4037]">
                                      allocation %
                                      <PercentField
                                        className={`${fieldBase} w-24`}
                                        value={rule.weight}
                                        onChange={(next) =>
                                          patch((draft) => ({
                                            ...draft,
                                            policies: draft.policies.map((p) =>
                                              p.id === policy.id
                                                ? { ...p, rules: p.rules.map((r, i) => (i === ruleIndex ? { ...r, weight: next } : r)) }
                                                : p,
                                            ),
                                          }))
                                        }
                                      />
                                    </span>
                                    <select
                                      className={`${fieldBase} w-48`}
                                      value={rule.method}
                                      onChange={(event) =>
                                        patch((draft) => ({
                                          ...draft,
                                          policies: draft.policies.map((p) =>
                                            p.id === policy.id
                                              ? {
                                                  ...p,
                                                  rules: p.rules.map((r, i) =>
                                                    i === ruleIndex
                                                      ? { ...r, method: event.target.value as (typeof ALLOCATION_METHODS)[number] }
                                                      : r,
                                                  ),
                                                }
                                              : p,
                                          ),
                                        }))
                                      }
                                    >
                                      {ALLOCATION_METHODS.map((method) => (
                                        <option key={method} value={method}>
                                          {ALLOCATION_METHOD_LABELS[method]}
                                        </option>
                                      ))}
                                    </select>
                                    {budget.unitTypes.map((type) => (
                                      <label key={type.name} className="flex items-center gap-1 text-xs text-[#5b5148]">
                                        <input
                                          type="checkbox"
                                          checked={rule.unitTypes.includes(type.name)}
                                          onChange={(event) =>
                                            patch((draft) => ({
                                              ...draft,
                                              policies: draft.policies.map((p) =>
                                                p.id === policy.id
                                                  ? {
                                                      ...p,
                                                      rules: p.rules.map((r, i) =>
                                                        i === ruleIndex
                                                          ? {
                                                              ...r,
                                                              unitTypes: event.target.checked
                                                                ? [...r.unitTypes, type.name]
                                                                : r.unitTypes.filter((item) => item !== type.name),
                                                            }
                                                          : r,
                                                      ),
                                                    }
                                                  : p,
                                              ),
                                            }))
                                          }
                                        />
                                        {type.name}
                                      </label>
                                    ))}
                                    {rule.unitTypes.length === 0 ? (
                                      <span className="text-xs italic text-[#b44b43]">select unit types</span>
                                    ) : null}
                                  </div>
                                  {policy.rules.length > 1 ? (
                                    <button
                                      type="button"
                                      className={`${iconButton} border-[#f0c8c6] text-[#c0443c] hover:border-[#e9a8a4]`}
                                      aria-label="Remove rule"
                                      onClick={() =>
                                        patch((draft) => ({
                                          ...draft,
                                          policies: draft.policies.map((p) =>
                                            p.id === policy.id ? { ...p, rules: p.rules.filter((_, i) => i !== ruleIndex) } : p,
                                          ),
                                        }))
                                      }
                                    >
                                      <TrashIcon />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                            <button
                              type="button"
                              className={`${pillButton} self-start`}
                              onClick={() =>
                                patch((draft) => ({
                                  ...draft,
                                  policies: draft.policies.map((p) =>
                                    p.id === policy.id
                                      ? { ...p, rules: [...p.rules, { unitTypes: [], weight: 0, method: "common_interest" }] }
                                      : p,
                                  ),
                                }))
                              }
                            >
                              Add rule
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            {/* Expenses */}
            <section className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className={`${sectionTitle} flex items-center gap-2`}
                  onClick={() => setCollapsedExpenses((value) => !value)}
                >
                  <span className="text-2xl leading-none text-[#8c7b6c]">{collapsedExpenses ? "▸" : "▾"}</span>
                  Expenses
                  <span className="text-sm font-normal text-[#9a8a7b]">({budget.expenses.length})</span>
                </button>
                {!collapsedExpenses && expenseCategories.length > 0 ? (
                  <button type="button" className={pillButton} onClick={toggleAllCategories}>
                    {allCategoriesCollapsed ? "Expand all" : "Collapse all"}
                  </button>
                ) : null}
              </div>
              {collapsedExpenses ? null : (
                <>
                  <p className={`${sectionHint} mt-1`}>
                    Grouped by category. Each line item is a per-year cost and a policy that decides how it is split. Drag the ☰ handle to
                    reorder categories, or sort the line items within a category by name, amount, or split.
                  </p>
                  <div className="mt-4 flex flex-col gap-5">
                    {expenseCategories.map((category) => {
                      const sort = expenseSort[category];
                      const items = applyOrder(
                        budget.expenses.filter((expense) => expense.category === category),
                        expenseOrder[category] ?? [],
                        (expense) => expense.id,
                      );
                      const catCollapsed = collapsedTypes.has(catKey(category));
                      const categoryTotal = items.reduce((sum, e) => sum + e.amount, 0);
                      return (
                        // biome-ignore lint/a11y/noStaticElementInteractions: native drag-and-drop reorder target
                        <div
                          key={category}
                          data-cat={category}
                          className={`flex flex-col gap-2 transition-opacity ${dragCategory === category ? "opacity-40" : ""}`}
                          onDragOver={(event) => {
                            if (dragCategory) {
                              event.preventDefault();
                              if (dragCategory !== category) {
                                moveCategory(dragCategory, category, isAfterMidpoint(event));
                              }
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            setDragCategory(null);
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
                              <span
                                draggable
                                onDragStart={(event) => {
                                  setDragCategory(category);
                                  const group = (event.currentTarget as HTMLElement).closest("[data-cat]");
                                  if (group) {
                                    event.dataTransfer.setDragImage(group, 20, 16);
                                  }
                                }}
                                onDragEnd={() => setDragCategory(null)}
                                className="cursor-grab select-none text-[#b3a392]"
                                title={`Drag to reorder category ${category}`}
                              >
                                ☰
                              </span>
                              <button
                                type="button"
                                className="flex items-center"
                                aria-label={catCollapsed ? `Expand ${category}` : `Collapse ${category}`}
                                onClick={() => toggleType(catKey(category))}
                              >
                                <span className="text-lg leading-none text-[#8c7b6c]">{catCollapsed ? "▸" : "▾"}</span>
                              </button>
                              <CategoryName category={category} onRename={renameCategory} />
                              {catCollapsed && items.length > 0 ? (
                                <span className="text-xs text-[#9a8a7b]">
                                  {items.length} item{items.length !== 1 ? "s" : ""} &middot; {formatCurrency(categoryTotal)}/yr
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              {!catCollapsed && items.length > 1 ? <span className={groupHeading}>Sort by</span> : null}
                              {!catCollapsed && items.length > 1 ? (
                                <div className="flex overflow-hidden rounded-full border border-[#d8c7b5] text-xs font-semibold">
                                  {(["name", "amount", "split"] as ExpenseSortKey[]).map((key) => {
                                    const active = sort?.key === key;
                                    return (
                                      <button
                                        key={key}
                                        type="button"
                                        className={`px-2.5 py-1 ${active ? "bg-[#1b1a17] text-white" : "text-[#5b5148]"}`}
                                        aria-label={`Sort ${category} by ${EXPENSE_SORT_LABELS[key].toLowerCase()}${active ? ` (${sort.dir === "asc" ? "ascending" : "descending"})` : ""}`}
                                        onClick={() => cycleExpenseSort(category, key)}
                                      >
                                        {EXPENSE_SORT_LABELS[key]}
                                        {active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                              <button
                                type="button"
                                className={`${iconButton} border-[#f0c8c6] text-[#c0443c] hover:border-[#e9a8a4]`}
                                aria-label={`Remove category ${category}`}
                                onClick={() =>
                                  patch((draft) => ({
                                    ...draft,
                                    categories: draft.categories.filter((item) => item !== category),
                                    expenses: draft.expenses.filter((expense) => expense.category !== category),
                                  }))
                                }
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </div>
                          {!catCollapsed &&
                            !dragCategory &&
                            items.map((expense, expenseIndex) => (
                              <div
                                key={expense.id}
                                className="grid gap-2 transition-opacity sm:grid-cols-[1.4fr_1fr_1.6fr_auto] sm:items-center"
                              >
                                <TextField
                                  id={`expense-name-${expense.id}`}
                                  className={field}
                                  value={expense.name}
                                  placeholder="New expense"
                                  onChange={(next) =>
                                    patch((draft) => ({
                                      ...draft,
                                      expenses: draft.expenses.map((e) => (e.id === expense.id ? { ...e, name: next } : e)),
                                    }))
                                  }
                                />
                                <CurrencyField
                                  className={field}
                                  value={expense.amount}
                                  onChange={(next) =>
                                    patch((draft) => ({
                                      ...draft,
                                      expenses: draft.expenses.map((e) => (e.id === expense.id ? { ...e, amount: next } : e)),
                                    }))
                                  }
                                />
                                <select
                                  className={field}
                                  value={expense.policyId}
                                  onChange={(event) =>
                                    patch((draft) => ({
                                      ...draft,
                                      expenses: draft.expenses.map((e) =>
                                        e.id === expense.id ? { ...e, policyId: event.target.value } : e,
                                      ),
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Tab" && !event.shiftKey && expenseIndex === items.length - 1) {
                                      event.preventDefault();
                                      addExpenseAndFocus(category);
                                    }
                                  }}
                                >
                                  {budget.policies.map((policy) => (
                                    <option key={policy.id} value={policy.id}>
                                      {policy.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className={`${iconButton} border-[#f0c8c6] text-[#c0443c] hover:border-[#e9a8a4]`}
                                  aria-label="Remove expense"
                                  onClick={() =>
                                    patch((draft) => ({ ...draft, expenses: draft.expenses.filter((e) => e.id !== expense.id) }))
                                  }
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            ))}
                          {!catCollapsed && !dragCategory && (
                            <button type="button" className={`${pillButton} self-start`} onClick={() => addExpenseAndFocus(category)}>
                              Add expense
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <InlineAdd
                      placeholder="Add category"
                      onAdd={(value) =>
                        patch((draft) =>
                          draft.categories.includes(value) ? draft : { ...draft, categories: [...draft.categories, value] },
                        )
                      }
                    />
                    <div className="mt-2 flex items-center justify-between border-t border-[#eadccb] pt-3 text-sm font-semibold text-[#181716]">
                      <span>Total expenses</span>
                      <span>{formatCurrency(budget.expenses.reduce((sum, expense) => sum + expense.amount, 0))}/yr</span>
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* Adjustments */}
            <section className={card}>
              <h2 className={sectionTitle}>Adjustments</h2>
              <p className={sectionHint}>
                Inflation scales the entered expense amounts. Reserve is added on top for savings. Offsets adjust every unit of a type (e.g.
                -5% to Commercial). Other income (e.g. laundry) is subtracted from the total, spread by each unit's share.
              </p>
              <div className="mt-4 flex flex-wrap gap-6">
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-[#4a4037]">
                  Inflation %
                  <PercentField
                    className={`${fieldBase} w-28`}
                    value={budget.adjustments.inflationPct}
                    onChange={(next) => patch((draft) => ({ ...draft, adjustments: { ...draft.adjustments, inflationPct: next } }))}
                  />
                </span>
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-[#4a4037]">
                  Reserve %
                  <PercentField
                    className={`${fieldBase} w-28`}
                    value={budget.adjustments.reservePct}
                    onChange={(next) => patch((draft) => ({ ...draft, adjustments: { ...draft.adjustments, reservePct: next } }))}
                  />
                </span>
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-[#4a4037]">
                  Other income $/yr
                  <CurrencyField
                    className={`${fieldBase} w-36`}
                    value={budget.adjustments.incomeOffset ?? 0}
                    onChange={(next) => patch((draft) => ({ ...draft, adjustments: { ...draft.adjustments, incomeOffset: next } }))}
                  />
                </span>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <span className={groupHeading}>Unit-type offsets</span>
                <button
                  type="button"
                  className={pillButton}
                  onClick={() =>
                    patch((draft) => ({
                      ...draft,
                      adjustments: {
                        ...draft.adjustments,
                        offsets: [...(draft.adjustments.offsets ?? []), { unitType: draft.unitTypes[0]?.name ?? "", pct: 0 }],
                      },
                    }))
                  }
                >
                  Add offset
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {(budget.adjustments.offsets ?? []).map((offset, offsetIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: offsets are positional and have no stable id
                  <div key={`offset-${offsetIndex}`} className="flex flex-wrap items-center gap-2">
                    <select
                      className={`${field} max-w-xs`}
                      value={offset.unitType}
                      onChange={(event) =>
                        patch((draft) => ({
                          ...draft,
                          adjustments: {
                            ...draft.adjustments,
                            offsets: (draft.adjustments.offsets ?? []).map((o, i) =>
                              i === offsetIndex ? { ...o, unitType: event.target.value } : o,
                            ),
                          },
                        }))
                      }
                    >
                      {budget.unitTypes.map((type) => (
                        <option key={type.name} value={type.name}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-[#4a4037]">
                      offset %
                      <NumberField
                        className={`${fieldBase} w-24`}
                        value={offset.pct}
                        onChange={(next) =>
                          patch((draft) => ({
                            ...draft,
                            adjustments: {
                              ...draft.adjustments,
                              offsets: (draft.adjustments.offsets ?? []).map((o, i) => (i === offsetIndex ? { ...o, pct: next } : o)),
                            },
                          }))
                        }
                      />
                    </span>
                    <button
                      type="button"
                      className={removeButton}
                      onClick={() =>
                        patch((draft) => ({
                          ...draft,
                          adjustments: {
                            ...draft.adjustments,
                            offsets: (draft.adjustments.offsets ?? []).filter((_, i) => i !== offsetIndex),
                          },
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "rules" ? (
          <>
            {/* Charges per owner */}
            <section className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className={sectionTitle}>Charges per owner</h2>
                <div className="flex flex-wrap items-center gap-2">
                  {result.perOwner.length > 0 ? (
                    <button type="button" className={pillButton} onClick={toggleAllCharges}>
                      {allChargesCollapsed ? "Expand all" : "Collapse all"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`${iconButton} ${showBreakdown ? "bg-[#1b1a17] text-white" : ""}`}
                    aria-label={showBreakdown ? "Hide breakdown" : "Show breakdown"}
                    title={showBreakdown ? "Hide breakdown" : "Show breakdown"}
                    onClick={() => setShowBreakdown((value) => !value)}
                  >
                    <SearchIcon />
                  </button>
                </div>
              </div>
              <p className={`${sectionHint} mt-1`}>
                Total {formatCurrency(result.totals.total)}/yr (base {formatCurrency(result.totals.base)}
                {budget.adjustments.inflationPct !== 0 ? ` incl. ${budget.adjustments.inflationPct}% inflation` : ""}
                {Math.abs(result.totals.offset) > 0.01
                  ? ` ${result.totals.offset < 0 ? "-" : "+"} offsets ${formatCurrency(Math.abs(result.totals.offset))}`
                  : ""}
                {Math.abs(result.totals.income) > 0.01
                  ? ` ${result.totals.income < 0 ? "-" : "+"} other income ${formatCurrency(Math.abs(result.totals.income))}`
                  : ""}
                {result.totals.reserve > 0.01 ? ` + reserve ${formatCurrency(result.totals.reserve)}` : ""}).{" "}
                {result.unallocated > 0.01 ? (
                  <span className="font-semibold text-[#b44b43]">{formatCurrency(result.unallocated)} unallocated.</span>
                ) : null}
              </p>
              <div className="mt-4 flex flex-col gap-4">
                {sortedPerOwner.map((owner) => {
                  const chargesCollapsed = collapsedCharges.has(owner.ownerId);
                  return (
                    <div key={owner.ownerId} className="rounded-2xl border border-[#f2e8dd] bg-[#fffaf3] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          className="flex items-center gap-2"
                          onClick={() =>
                            setCollapsedCharges((prev) => {
                              const next = new Set(prev);
                              if (next.has(owner.ownerId)) {
                                next.delete(owner.ownerId);
                              } else {
                                next.add(owner.ownerId);
                              }
                              return next;
                            })
                          }
                        >
                          <span className="text-lg leading-none text-[#8c7b6c]">{chargesCollapsed ? "▸" : "▾"}</span>
                          <span className={`font-semibold ${owner.excluded ? "text-[#a89a8b]" : "text-[#181716]"}`}>
                            {owner.name}
                            {owner.excluded ? <span className="ml-2 text-xs italic">excluded</span> : null}
                          </span>
                        </button>
                        <span className={`font-semibold ${owner.excluded ? "text-[#a89a8b]" : "text-[#181716]"}`}>
                          {formatCurrency(owner.monthly)}/mo
                        </span>
                      </div>
                      {chargesCollapsed ? null : (
                        <>
                          {owner.excluded
                            ? null
                            : (() => {
                                const delta = owner.monthly - owner.currentMonthly;
                                const up = delta >= 0;
                                const color = Math.abs(delta) < 0.01 ? "text-[#5b5148]" : up ? "text-[#b44b43]" : "text-[#3f7a52]";
                                return (
                                  <div className="mt-1 text-sm text-[#5b5148]">
                                    current {formatCurrency(owner.currentMonthly)}/mo &rarr; new {formatCurrency(owner.monthly)}/mo{" "}
                                    <span className={`font-semibold ${color}`}>
                                      ({up ? "+" : "-"}
                                      {formatCurrency(Math.abs(delta))}/mo
                                      {owner.currentMonthly > 0
                                        ? `, ${up ? "+" : "-"}${Math.abs((delta / owner.currentMonthly) * 100).toFixed(1)}%`
                                        : ""}
                                      )
                                    </span>
                                  </div>
                                );
                              })()}
                          <div className={`mt-3 grid gap-4 ${showBreakdown ? "md:grid-cols-2" : ""}`}>
                            <div className="flex flex-col gap-1">
                              <p className={groupHeading}>Per unit</p>
                              {(unitsByOwner.get(owner.ownerId) ?? []).map((unit) => (
                                <div key={unit.unitId} className="flex items-center justify-between text-sm text-[#4a4037]">
                                  <span>
                                    {unit.label} <span className="text-xs text-[#9a8a7b]">({unit.type})</span>
                                  </span>
                                  <span>{formatCurrency(unit.monthly)}/mo</span>
                                </div>
                              ))}
                            </div>
                            {showBreakdown ? (
                              <div className="flex flex-col gap-2">
                                <p className={groupHeading}>Breakdown ($/mo)</p>
                                {(() => {
                                  const units = unitsByOwner.get(owner.ownerId) ?? [];
                                  if (units.length === 0) {
                                    return <p className="text-sm italic text-[#9a8a7b]">No units.</p>;
                                  }
                                  const rows = budget.expenses.filter((expense) =>
                                    units.some((u) => Math.abs(u.byExpense[expense.id] ?? 0) > 0.005),
                                  );
                                  const showOffset = units.some((u) => Math.abs(u.offset) > 0.005);
                                  const showIncome = units.some((u) => Math.abs(u.income) > 0.005);
                                  const showReserve = units.some((u) => Math.abs(u.reserve) > 0.005);
                                  return (
                                    <div className="overflow-x-auto">
                                      <table className="w-full border-collapse text-xs">
                                        <thead>
                                          <tr className="text-left text-[#8c7b6c]">
                                            <th className="py-1 pr-3 font-semibold" />
                                            {units.map((u) => (
                                              <th key={u.unitId} className="py-1 pl-3 text-right font-semibold">
                                                {u.label}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody className="text-[#4a4037]">
                                          {rows.map((expense) => (
                                            <tr key={expense.id} className="border-t border-[#f2e8dd]">
                                              <td className="py-1 pr-3">{expenseName.get(expense.id)}</td>
                                              {units.map((u) => (
                                                <td key={u.unitId} className="py-1 pl-3 text-right">
                                                  {formatCurrency((u.byExpense[expense.id] ?? 0) / 12)}
                                                </td>
                                              ))}
                                            </tr>
                                          ))}
                                          {showOffset ? (
                                            <tr className="border-t border-[#f2e8dd]">
                                              <td className="py-1 pr-3">Offset</td>
                                              {units.map((u) => (
                                                <td key={u.unitId} className="py-1 pl-3 text-right">
                                                  {formatCurrency(u.offset / 12)}
                                                </td>
                                              ))}
                                            </tr>
                                          ) : null}
                                          {showIncome ? (
                                            <tr className="border-t border-[#f2e8dd]">
                                              <td className="py-1 pr-3">Income</td>
                                              {units.map((u) => (
                                                <td key={u.unitId} className="py-1 pl-3 text-right">
                                                  {formatCurrency(u.income / 12)}
                                                </td>
                                              ))}
                                            </tr>
                                          ) : null}
                                          {showReserve ? (
                                            <tr className="border-t border-[#f2e8dd]">
                                              <td className="py-1 pr-3">Reserve</td>
                                              {units.map((u) => (
                                                <td key={u.unitId} className="py-1 pl-3 text-right">
                                                  {formatCurrency(u.reserve / 12)}
                                                </td>
                                              ))}
                                            </tr>
                                          ) : null}
                                          <tr className="border-t border-[#eadccb] font-semibold text-[#181716]">
                                            <td className="py-1 pr-3">Total</td>
                                            {units.map((u) => (
                                              <td key={u.unitId} className="py-1 pl-3 text-right">
                                                {formatCurrency(u.monthly)}
                                              </td>
                                            ))}
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })()}
                              </div>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </main>

      {batch !== null ? (
        <BatchModal
          kind={batch}
          unitTypeNames={budget.unitTypes.map((type) => type.name)}
          owners={budget.owners}
          onCancel={() => setBatch(null)}
          onApplyOwners={(owners, replaceAll) => {
            applyBatchOwners(owners, replaceAll);
            setBatch(null);
          }}
          onApplyUnits={(units, replaceAll) => {
            applyBatchUnits(units, replaceAll);
            setBatch(null);
          }}
          onApplyUnitTypes={(unitTypes, replaceAll) => {
            applyBatchUnitTypes(unitTypes, replaceAll);
            setBatch(null);
          }}
        />
      ) : null}
    </div>
  );
}

function BatchModal({
  kind,
  unitTypeNames,
  owners,
  onCancel,
  onApplyOwners,
  onApplyUnits,
  onApplyUnitTypes,
}: {
  kind: "owner" | "unit" | "unitType";
  unitTypeNames: string[];
  owners: Owner[];
  onCancel: () => void;
  onApplyOwners: (owners: Owner[], replaceAll: boolean) => void;
  onApplyUnits: (units: Unit[], replaceAll: boolean) => void;
  onApplyUnitTypes: (unitTypes: UnitType[], replaceAll: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [replaceAll, setReplaceAll] = useState(false);
  const noun = kind === "owner" ? "owners" : kind === "unit" ? "units" : "unit types";

  const ownerResult = useMemo(() => (kind === "owner" ? parseOwnerLines(text) : null), [kind, text]);
  const unitResult = useMemo(
    () => (kind === "unit" ? parseUnitLines(text, unitTypeNames, owners) : null),
    [kind, text, unitTypeNames, owners],
  );
  const unitTypeResult = useMemo(() => (kind === "unitType" ? parseUnitTypeLines(text) : null), [kind, text]);

  const parsedCount =
    kind === "owner"
      ? (ownerResult?.owners.length ?? 0)
      : kind === "unit"
        ? (unitResult?.units.length ?? 0)
        : (unitTypeResult?.unitTypes.length ?? 0);
  const skipped = (kind === "unit" ? unitResult?.skipped : kind === "unitType" ? unitTypeResult?.skipped : []) ?? [];

  const apply = () => {
    if (kind === "owner" && ownerResult) {
      onApplyOwners(ownerResult.owners, replaceAll);
    } else if (kind === "unit" && unitResult) {
      onApplyUnits(unitResult.units, replaceAll);
    } else if (kind === "unitType" && unitTypeResult) {
      onApplyUnitTypes(unitTypeResult.unitTypes, replaceAll);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Batch add ${noun}`}
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-[#e7d7c8] bg-[#fbf6ef] p-6 shadow-2xl"
      >
        <h3 className="text-xl font-semibold text-[#181716]">Batch add {noun}</h3>
        <p className="mt-1 text-sm text-[#5b5148]">
          {kind === "owner"
            ? "One owner per line: name, current monthly (comma or tab separated). The amount is optional and may have a $ prefix. Exclusion is not set here; toggle it afterwards."
            : kind === "unit"
              ? "One unit per line: label, type, common interest, owner (comma or tab separated). Owner is matched by name to an existing owner."
              : "One unit type per line: name, classification (comma or tab separated). Classification is optional and defaults to Primary; use 'primary' or 'ancillary'."}
        </p>
        <textarea
          className="mt-3 h-44 w-full rounded-xl border border-[#e6d7c7] bg-white px-3 py-2 font-mono text-sm text-[#1d1b18] outline-none focus:border-[#c9a888] focus:ring-2 focus:ring-[#edc9a6]/60"
          value={text}
          placeholder={
            kind === "owner"
              ? "Alice, $1000\nBob, 900\nMaple Holdings LLC, $650"
              : kind === "unit"
                ? "1A, residential, 30, Alice\nCU1, commercial, 20, Maple Holdings LLC"
                : "Residential, primary\nStorage, ancillary\nGarage, ancillary"
          }
          onChange={(event) => setText(event.target.value)}
        />

        <div className="mt-3 text-sm text-[#4a4037]">
          <p>
            <span className="font-semibold text-[#3f7a52]">{parsedCount}</span> parsed
            {kind !== "owner" ? (
              <>
                , <span className={skipped.length > 0 ? "font-semibold text-[#b44b43]" : ""}>{skipped.length}</span> skipped
              </>
            ) : null}
            .
          </p>
          {skipped.length > 0 ? (
            <ul className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-[#eccfa3] bg-[#fff6e6] p-2 text-xs text-[#7a5a23]">
              {skipped.map((entry) => (
                <li key={`${entry.line}-${entry.reason}`}>
                  <span className="font-mono">{entry.line}</span> — {entry.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-[#4a4037]">
          <input type="checkbox" checked={replaceAll} onChange={(event) => setReplaceAll(event.target.checked)} />
          Replace all existing {noun}
        </label>

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className={pillButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`${solidButton} disabled:opacity-40`} disabled={parsedCount === 0} onClick={apply}>
            {replaceAll ? "Replace" : "Add"} {parsedCount > 0 ? `(${parsedCount})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// Numeric input that clears a leading 0 on focus instead of forcing you to delete it.
function NumberField({
  value,
  onChange,
  className,
  step = "0.01",
}: {
  value: number;
  onChange: (next: number) => void;
  className: string;
  step?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const next = Number(draft) || 0;
      if (next !== value) {
        onChange(next);
      }
    }
    setDraft(null);
  };
  return (
    <input
      className={className}
      type="number"
      step={step}
      value={draft ?? String(value)}
      onFocus={() => setDraft(value === 0 ? "" : String(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

// Currency input with a $ prefix: ignores a typed $, shows 2 decimals when idle, raw value while editing.
function CurrencyField({ value, onChange, className }: { value: number; onChange: (next: number) => void; className: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const next = Number(draft.replace(/[$,]/g, "")) || 0;
      if (next !== value) {
        onChange(next);
      }
    }
    setDraft(null);
  };
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#8a7768]">$</span>
      <input
        className={`${className} pl-7`}
        type="text"
        inputMode="decimal"
        value={draft ?? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        onFocus={() => setDraft(value === 0 ? "" : String(value))}
        onChange={(event) => setDraft(event.target.value.replace(/\$/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

// Like NumberField but clamped to 0-100.
function PercentField({
  value,
  onChange,
  className,
  step = "0.01",
}: {
  value: number;
  onChange: (next: number) => void;
  className: string;
  step?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const parsed = Number(draft);
      const next = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
      if (next !== value) {
        onChange(next);
      }
    }
    setDraft(null);
  };
  return (
    <input
      className={className}
      type="number"
      min={0}
      max={100}
      step={step}
      value={draft ?? String(value)}
      onFocus={() => setDraft(value === 0 ? "" : String(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

// Common-interest input: shows 4 decimals (with trailing zeros) when idle, raw value while editing.
function CiInput({ value, onChange, className }: { value: number; onChange: (next: number) => void; className: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const next = Number(draft.replace(/%/g, "")) || 0;
      if (next !== value) {
        onChange(next);
      }
    }
    setDraft(null);
  };
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      value={draft ?? formatCi(value)}
      onFocus={() => setDraft(value === 0 ? "" : String(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

// Text input that buffers typing locally and commits on blur or Enter, so the
// expensive budget recompute only runs once you leave the field.
function TextField({
  value,
  onChange,
  className,
  id,
  placeholder,
  onKeyDown,
}: {
  value: string;
  onChange: (next: string) => void;
  className: string;
  id?: string;
  placeholder?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) {
      onChange(draft);
    }
    setDraft(null);
  };
  return (
    <input
      id={id}
      className={className}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        onKeyDown?.(event);
      }}
    />
  );
}

// Editable category name; commits the rename on blur or Enter.
function CategoryName({ category, onRename }: { category: string; onRename: (from: string, to: string) => void }) {
  const [draft, setDraft] = useState(category);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== category) {
      onRename(category, next);
    } else {
      setDraft(category);
    }
  };
  return (
    <input
      className={`${fieldBase} max-w-xs`}
      value={draft}
      placeholder="Category name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

// Single text input + Add button (Enter also submits) for inline list additions.
function InlineAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      onAdd(trimmed);
    }
    setDraft("");
  };
  return (
    <div className="flex items-center gap-2">
      <input
        className={`${field} max-w-xs`}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
      />
      <button type="button" className={pillButton} onClick={add}>
        Add
      </button>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#5b5148]">Loading…</div>}>
      <HomeContent />
    </Suspense>
  );
}
