"use server";

import { redirect } from "next/navigation";
import { requireUser, withTransactions } from "@/app/_server/services";
import { acceptInvite } from "@/lib/server/store";

// When the invite cannot be accepted, its page explains why.
export const acceptInviteAction = async (token: string): Promise<void> => {
  const { id: userId } = await requireUser();
  const result = await withTransactions((db) => acceptInvite(db, userId, token, new Date()));
  redirect(
    result.status === "joined" || result.status === "open" ? `/budgets/${result.budgetId}` : `/invites/${encodeURIComponent(token)}`,
  );
};
