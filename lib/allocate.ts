import type { Budget, PolicyRule, Unit } from "./types";

export type UnitCharge = {
  unitId: string;
  label: string;
  type: string;
  ownerId: string;
  excluded: boolean;
  byExpense: Record<string, number>;
  byCategory: Record<string, number>;
  base: number;
  offset: number;
  income: number;
  reserve: number;
  total: number;
  monthly: number;
};

export type OwnerCharge = {
  ownerId: string;
  name: string;
  excluded: boolean;
  total: number;
  monthly: number;
  currentMonthly: number;
};

export type ChargeResult = {
  perUnit: UnitCharge[];
  perOwner: OwnerCharge[];
  byCategory: Record<string, number>;
  totals: { base: number; offset: number; income: number; reserve: number; total: number; monthly: number };
  unallocated: number;
  warnings: string[];
};

// Splits one rule's dollar amount across the eligible units, returning a unitId -> amount map.
const splitRule = (rule: PolicyRule, amount: number, eligible: Unit[]): Map<string, number> => {
  const result = new Map<string, number>();
  if (eligible.length === 0 || amount === 0) {
    return result;
  }

  if (rule.method === "equal_per_unit") {
    const share = amount / eligible.length;
    for (const unit of eligible) {
      result.set(unit.id, share);
    }
    return result;
  }

  // common_interest: proportional to common interest, with an equal-split fallback
  // when the eligible units carry no common interest.
  const ciSum = eligible.reduce((sum, unit) => sum + unit.commonInterest, 0);
  if (ciSum <= 0) {
    const share = amount / eligible.length;
    for (const unit of eligible) {
      result.set(unit.id, share);
    }
    return result;
  }
  for (const unit of eligible) {
    result.set(unit.id, amount * (unit.commonInterest / ciSum));
  }
  return result;
};

export const computeCharges = (budget: Budget): ChargeResult => {
  const excludedOwners = new Set(budget.owners.filter((owner) => owner.excluded).map((owner) => owner.id));
  const payingUnits = budget.units.filter((unit) => !excludedOwners.has(unit.ownerId));
  const policyById = new Map(budget.policies.map((policy) => [policy.id, policy]));
  const inflationFactor = 1 + budget.adjustments.inflationPct / 100;
  const reserveFactor = budget.adjustments.reservePct / 100;
  const offsetByType = new Map((budget.adjustments.offsets ?? []).map((offset) => [offset.unitType, offset.pct]));

  const charges = new Map<string, UnitCharge>(
    budget.units.map((unit) => {
      const owner = budget.owners.find((candidate) => candidate.id === unit.ownerId);
      return [
        unit.id,
        {
          unitId: unit.id,
          label: unit.label,
          type: unit.type,
          ownerId: unit.ownerId,
          excluded: Boolean(owner?.excluded),
          byExpense: {},
          byCategory: {},
          base: 0,
          offset: 0,
          income: 0,
          reserve: 0,
          total: 0,
          monthly: 0,
        },
      ];
    }),
  );

  let unallocated = 0;
  const warnings: string[] = [];

  for (const expense of budget.expenses) {
    const effective = expense.amount * inflationFactor;
    const policy = expense.policyId ? policyById.get(expense.policyId) : undefined;
    if (!policy) {
      unallocated += effective;
      warnings.push(`Expense "${expense.name}" has no valid policy; ${effective} left unallocated.`);
      continue;
    }

    for (const rule of policy.rules) {
      const ruleAmount = effective * (rule.weight / 100);
      const eligible = payingUnits.filter((unit) => rule.unitTypes.includes(unit.type));
      if (eligible.length === 0) {
        unallocated += ruleAmount;
        warnings.push(`Expense "${expense.name}" has a rule with no eligible units; ${ruleAmount} left unallocated.`);
        continue;
      }

      for (const [unitId, amount] of splitRule(rule, ruleAmount, eligible)) {
        const charge = charges.get(unitId);
        if (!charge) {
          continue;
        }
        charge.byExpense[expense.id] = (charge.byExpense[expense.id] ?? 0) + amount;
        charge.byCategory[expense.category] = (charge.byCategory[expense.category] ?? 0) + amount;
        charge.base += amount;
      }
    }
  }

  // Offsets are a zero-sum rebalance: an affected unit's discount/surcharge is moved
  // onto the unaffected units (by common interest), so the building's total is unchanged.
  const ciByUnit = new Map(budget.units.map((unit) => [unit.id, unit.commonInterest]));
  let rebalancePool = 0;
  for (const charge of charges.values()) {
    if (charge.excluded) {
      continue;
    }
    const pct = offsetByType.get(charge.type);
    if (pct === undefined) {
      continue;
    }
    charge.offset = charge.base * (pct / 100);
    rebalancePool -= charge.offset;
  }

  const recipients = [...charges.values()].filter((charge) => !charge.excluded && !offsetByType.has(charge.type));
  if (recipients.length > 0 && Math.abs(rebalancePool) > 0) {
    const ciSum = recipients.reduce((sum, charge) => sum + (ciByUnit.get(charge.unitId) ?? 0), 0);
    for (const charge of recipients) {
      const share = ciSum > 0 ? (ciByUnit.get(charge.unitId) ?? 0) / ciSum : 1 / recipients.length;
      charge.offset += rebalancePool * share;
    }
  } else if (Math.abs(rebalancePool) > 0.01) {
    warnings.push("Offsets could not be rebalanced because every unit type has an offset.");
  }

  // Non-common-charge income reduces the total to collect, spread proportional to each unit's base.
  const basePool = [...charges.values()].reduce((sum, charge) => sum + charge.base, 0);
  const incomeFactor = basePool > 0 ? (budget.adjustments.incomeOffset ?? 0) / basePool : 0;

  const byCategory: Record<string, number> = {};
  const ownerTotals = new Map<string, number>();
  let totalBase = 0;
  let totalOffset = 0;
  let totalIncome = 0;
  let totalReserve = 0;

  for (const charge of charges.values()) {
    charge.income = -charge.base * incomeFactor;
    const net = charge.base + charge.offset + charge.income;
    charge.reserve = net * reserveFactor;
    charge.total = net + charge.reserve;
    charge.monthly = charge.total / 12;
    totalBase += charge.base;
    totalOffset += charge.offset;
    totalIncome += charge.income;
    totalReserve += charge.reserve;
    for (const [category, amount] of Object.entries(charge.byCategory)) {
      byCategory[category] = (byCategory[category] ?? 0) + amount;
    }
    ownerTotals.set(charge.ownerId, (ownerTotals.get(charge.ownerId) ?? 0) + charge.total);
  }

  const perOwner: OwnerCharge[] = budget.owners.map((owner) => {
    const total = ownerTotals.get(owner.id) ?? 0;
    return {
      ownerId: owner.id,
      name: owner.name,
      excluded: owner.excluded,
      total,
      monthly: total / 12,
      currentMonthly: owner.currentMonthly,
    };
  });

  const total = totalBase + totalOffset + totalIncome + totalReserve;
  return {
    perUnit: [...charges.values()],
    perOwner,
    byCategory,
    totals: { base: totalBase, offset: totalOffset, income: totalIncome, reserve: totalReserve, total, monthly: total / 12 },
    unallocated,
    warnings,
  };
};
