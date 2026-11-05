"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { DEFAULT_BUDGET } from "../lib/budget";
import { parseBudgetUrl, serializeBudgetUrl } from "../lib/serialize";
import { Calculator, replaceSearchParams } from "./_components/calculator";
import { SaveToAccountButton } from "./_components/save-to-account";
import type { Budget } from "../lib/types";

const writeBudgetParam = (budget: Budget) => replaceSearchParams({ b: serializeBudgetUrl(budget) });

function HomeContent() {
  const searchParams = useSearchParams();
  const [initialBudget] = useState(() => parseBudgetUrl(searchParams.get("b")) ?? DEFAULT_BUDGET);
  return <Calculator initialBudget={initialBudget} onBudgetChange={writeBudgetParam} actions={<SaveToAccountButton />} />;
}

export default function Home() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#5b5148]">Loading…</div>}>
      <HomeContent />
    </Suspense>
  );
}
